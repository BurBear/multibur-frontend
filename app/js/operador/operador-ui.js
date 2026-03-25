import { createToastController } from "../utils/toast.js";
import { createMessageSetters } from "../utils/messages.js";
import { byId, setDisabledById, getValueById, setTextById } from "../utils/dom.js";

let audioUnlocked = false;
const { showToast } = createToastController();
const { msgL, msgR, msgHoy, msgInc, msgPause } = createMessageSetters({
  msgL: "msgLeft",
  msgR: "msgRight",
  msgHoy: "msgHoy",
  msgInc: "incidentMsg",
  msgPause: "pauseMsg"
});

export const el = byId;

export function setVal(id, value) {
  setTextById(id, value);
}

export function setDisabled(id, value) {
  setDisabledById(id, value);
}

export function getValue(id) {
  return getValueById(id);
}

export function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
}

export function playAlertBeep() {
  if (!audioUnlocked) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
  osc.onended = () => ctx.close().catch(() => {});
}

export { showToast, msgL, msgR, msgHoy, msgInc, msgPause };
