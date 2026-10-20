// The ElevenLabs key lives in the macOS login Keychain and nowhere else (check C7).
// It is read with `security … -w`, so it travels on the child's stdout, never in argv,
// and it is held in this process's memory only.
import { execFile } from "node:child_process";

export const SERVICE = "lucky-loop.elevenlabs";
export const ACCOUNT = "voice-bridge";

let cached = null;

export function readKey() {
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
      { timeout: 30_000 }, (err, stdout) => {
        if (err) return reject(new Error("no ElevenLabs key in the Keychain (run voice/bin/set-key)"));
        const key = stdout.trim();
        if (!key) return reject(new Error("the Keychain item is empty"));
        cached = key;
        resolve(key);
      });
  });
}

export function forgetKey() {
  cached = null;
}
