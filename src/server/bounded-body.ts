export async function boundedBody(request: Request, maximum = 24_000, deadline = 3000) {
  const reader=request.body?.getReader();
  if(!reader) throw new BodyError(400);
  let bytes=0, body="";
  const decoder=new TextDecoder();
  let expired=false;
  const timer=setTimeout(() => { expired=true; void reader.cancel().catch(() => {}); },deadline);
  try {
    while(true) {
      const chunk=await reader.read();
      if(expired || request.signal.aborted)throw new BodyError(408);
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>maximum)throw new BodyError(413);
      body+=decoder.decode(chunk.value,{stream:true});
    }
    return body+decoder.decode();
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class BodyError extends Error { constructor(public status:number){super("Invalid request body");} }
