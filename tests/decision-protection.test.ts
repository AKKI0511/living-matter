import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedBody, BodyError } from "../src/server/bounded-body";
import { budgetScript, reserveDecision } from "../src/server/decision-budget";

test("request bodies enforce actual bytes and a read deadline", async () => {
  assert.equal(await boundedBody(new Request("http://localhost", {method:"POST",body:"{}"})),"{}");
  await assert.rejects(boundedBody(new Request("http://localhost",{method:"POST",body:"éé"}),3),e=>e instanceof BodyError && e.status===413);
  const body=new ReadableStream({ start() {} });
  await assert.rejects(boundedBody(new Request("http://localhost",{method:"POST",body,duplex:"half"} as RequestInit),24_000,20),e=>e instanceof BodyError && e.status===408);
});

test("shared budget reserves all counters atomically and fails closed on storage errors", async () => {
  const previous={url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN,env:process.env.NODE_ENV};
  process.env.UPSTASH_REDIS_REST_URL="https://budget.example"; process.env.UPSTASH_REDIS_REST_TOKEN="test-token";
  const request=new Request("https://game.example/api/decision", {headers:{"x-vercel-forwarded-for":"198.51.100.3"}});
  try {
    const transport:typeof fetch=async (_url,init) => {
      const command=JSON.parse(init!.body as string);
      assert.equal(command[0],"EVAL"); assert.equal(command[1],budgetScript); assert.equal(command[2],"3");
      assert.match(command[4],/^lm:ip:[0-9a-f]{24}:/); assert.equal(command[5],"lm:session:run");
      return Response.json({result:1});
    };
    assert.equal(await reserveDecision(request,"run",transport),true);
    assert.equal(await reserveDecision(request,"run",async()=>Response.json({result:0})),false);
    await assert.rejects(reserveDecision(request,"run",async()=>Response.json({error:"unavailable"})),/unavailable/);
    delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
    (process.env as Record<string,string|undefined>).NODE_ENV="production";
    await assert.rejects(reserveDecision(request,"run"),/unavailable/);
  } finally {
    for(const [key,value] of [["UPSTASH_REDIS_REST_URL",previous.url],["UPSTASH_REDIS_REST_TOKEN",previous.token],["NODE_ENV",previous.env]]) {
      if(value===undefined)delete process.env[key!];else process.env[key!]=value;
    }
  }
});
