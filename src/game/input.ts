export const input = {
  forward: 0,
  right: 0,
  jump: false,
  jumpQueued: false,
  sprint: false,
  yaw: 0,
  pitch: -0.03,
  dragging: false,
};
export function clearInput() {
  input.forward = 0;
  input.right = 0;
  input.jump = false;
  input.jumpQueued = false;
  input.sprint = false;
  input.dragging = false;
}
