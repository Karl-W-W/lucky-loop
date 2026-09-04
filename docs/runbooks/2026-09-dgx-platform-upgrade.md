# Runbook — DGX platform upgrade (Phase 2)

**Status:** prepared 2026-08-31, NOT executed. Reboot requires Karl's explicit go.
**Recommended window:** after 2026-09-10 (reasoning in *When*, below).

This is the half of the apt backlog that is **not** a patch run. Phase 1
(security-only, via `unattended-upgrade`) is separate and carries none of this
risk.

## What this actually changes

Six platform changes hide inside "670 packages upgradable". Each is individually
a scheduled change; together they need a window.

| Component | From → to | Why it is not routine |
|---|---|---|
| `dgx-release` | **7.3.1 → 7.5.0** | a DGX **OS release** upgrade |
| kernel (`linux-*-nvidia-hwe-24.04`) | **6.14.0-1015 → 6.17.0-1031** | minor-version jump; new nvidia modules built against it |
| driver | 580.95.05 → **580.173.02** | all `libnvidia-*`, `xserver-xorg-video-nvidia-580` |
| `containerd.io` | **1.7.28 → 2.2.1** | **major.** Runs the vault's Postgres, Phoenix, pg-proxy |
| `docker-ce` | 28.5.1 → **29.2.1** | major; compose plugin 2.40 → **5.0.2** |
| CUDA | 13.0.2 → 13.0.3, cuBLAS 13.1.0 → 13.1.1 | llama.cpp was built against 13.0.88 |

Also noted, benign but worth seeing: `nvidia-modprobe` and `nvidia-settings`
jump to **610.57.04** while the driver goes to **580.173.02** — mixed branches
from the CUDA repo.

**The two hazards, named.** containerd 1.x → 2.x is a major runtime change
underneath the database that holds the vault. And the driver+CUDA bump can
invalidate the `-DGGML_CUDA=ON` build that produced **0.67 s** reranking
(vs 25.4 s on CPU) — that has to be re-tested, not assumed.

## When

**Recommendation: after 2026-09-10.** Three reasons, none urgent-sounding, which
is the point:

1. The failure-tile guard collapse is predicted for **2026-09-03**. That is a
   falsifiable moment worth observing cleanly; a platform upgrade in the same
   window confounds it.
2. The reranker's fate (park vs. promote the CUDA build) is still an open
   decision. Deciding first means one re-test, not two.
3. Phase 1 already closes the actual security debt. Nothing here is a security
   fix that Phase 1 does not also deliver.

"Tomorrow" is defensible if you want it done — the risk is manageable, it is
just not free. Say which and this runbook does not change.

## Before: capture state you will want back

Run **all** of these and keep the output. Nothing here writes.

```bash
# 1. container state — the thing containerd 2.x could disturb
ssh dgx-remote 'docker ps -a --format "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"' | tee ~/dgx-pre-containers.txt
ssh dgx-remote 'docker volume ls; docker network ls'
ssh dgx-remote 'docker info --format "server={{.ServerVersion}} runtime={{.DefaultRuntime}} cgroup={{.CgroupDriver}}"'

# 2. versions, so "did it move" is answerable afterwards
ssh dgx-remote 'uname -r; nvidia-smi --query-gpu=driver_version --format=csv,noheader; \
  /usr/local/cuda/bin/nvcc --version | tail -2; cat /etc/dgx-release; \
  dpkg -l | grep -E "^ii (docker-ce|containerd.io) " ' | tee ~/dgx-pre-versions.txt

# 3. enabled units, so a service that fails to come back is visible
ssh dgx-remote 'systemctl list-unit-files --state=enabled --no-legend --plain; \
  systemctl --user list-unit-files --state=enabled --no-legend --plain' | tee ~/dgx-pre-units.txt

# 4. the reranker baseline to compare against (GPU build, 30 docs)
#    expect ~0.67s and nvidia-smi util moving 0 -> ~80% during the call
```

## Vault Postgres — back it up AND prove it restores

A backup nobody has restored is not a backup. Do both halves.

```bash
# dump (container name from step 1; brain-pgv at time of writing)
ssh dgx-remote 'docker exec brain-pgv pg_dumpall -U postgres' > ~/vault-pg-$(date +%F).sql
ls -lh ~/vault-pg-*.sql          # sanity: must be non-trivial, not 0 bytes

# PROVE it restores — into a THROWAWAY container, never over the live one
ssh dgx-remote 'docker run -d --rm --name pgrestoretest -e POSTGRES_PASSWORD=x pgvector/pgvector:pg17'
sleep 15
ssh dgx-remote 'docker exec -i pgrestoretest psql -U postgres' < ~/vault-pg-$(date +%F).sql
ssh dgx-remote 'docker exec pgrestoretest psql -U postgres -c "\l"'      # databases present?
ssh dgx-remote 'docker exec pgrestoretest psql -U postgres -d gbrain -c "select count(*) from pages;"'
ssh dgx-remote 'docker stop pgrestoretest'
```

**Do not proceed if the restore test fails or the row count looks wrong.** That
is the whole gate.

## Execute

NVIDIA's documented path for DGX Spark. `dist-upgrade` is correct here — the
sources are NVIDIA's pinned DGX repo — but `do-release-upgrade` must **never**
be run: it jumps Ubuntu releases and takes the NVIDIA stack with it.

```bash
ssh -t dgx-remote 'sudo apt update'
ssh -t dgx-remote 'sudo apt -s dist-upgrade | tail -30'   # SIMULATE first, read it
ssh -t dgx-remote 'sudo apt dist-upgrade'
ssh -t dgx-remote 'sudo fwupdmgr refresh && sudo fwupdmgr get-updates'
ssh -t dgx-remote 'sudo fwupdmgr update'
# STOP. Reboot only on Karl's explicit go.
```

Mask state survives this: `openclaw-gateway` and `voice-bot` are masked via
`/dev/null` symlinks in `~/.config/systemd/user/`, which a package upgrade does
not touch. Verify anyway (below).

## After: verify, in this order

```bash
# 1. did the platform actually move
ssh dgx-remote 'uname -r; cat /etc/dgx-release | head -3; \
  nvidia-smi --query-gpu=driver_version --format=csv,noheader'

# 2. containers — compare against dgx-pre-containers.txt. Every one must be back.
ssh dgx-remote 'docker ps -a --format "{{.Names}}\t{{.Status}}"'

# 3. the vault answers
ssh dgx-remote 'docker exec brain-pgv psql -U postgres -d gbrain -c "select count(*) from pages;"'

# 4. the loop and the fleet
ssh dgx-remote 'systemctl --user is-active hermes-serve polysignal-scanner lucky-loop.timer'
ssh dgx-remote 'systemctl --user is-active openclaw-gateway voice-bot'   # must be inactive/failed, still masked
ssh dgx-remote 'systemctl --failed; systemctl --user --failed'

# 5. infra-watch still green (13/13) and the Fleet view still answers
ssh dgx-remote 'python3 ~/brain/tools/infra-watch.py | tail -2'
```

### Reranker re-test — the one most likely to break

The CUDA build lives at `~/llama.cpp/build-cuda/bin/llama-server` and was
compiled against CUDA 13.0.88. A driver + toolkit bump can invalidate it.

```bash
# does the binary still start and still link CUDA?
ssh dgx-remote 'ldd ~/llama.cpp/build-cuda/bin/llama-server | grep -ci "libcuda\|libcublas"'
ssh dgx-remote 'nohup ~/llama.cpp/build-cuda/bin/llama-server \
  --model ~/models/qwen3-reranker/model.gguf --alias qwen3-reranker-4b-cuda \
  --reranking --host 127.0.0.1 --port 8082 --ctx-size 4096 -ngl 99 > ~/rr-retest.log 2>&1 &'
# then the 30-doc payload, timed, with nvidia-smi sampled during the call.
# PASS: < 1.5s and GPU util visibly leaves 0%.   FAIL: rebuild with
#   cd ~/llama.cpp && cmake -B build-cuda -DGGML_CUDA=ON -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF
#   cmake --build build-cuda --target llama-server -j 12
```

## Rollback

Ordered by cost. Try in order.

1. **A service did not come back.** Not a platform problem — check
   `journalctl -u <unit> -n 50`, fix forward. Nothing below is warranted.
2. **Kernel or driver broke boot / GPU.** The previous kernel is still
   installed: hold shift at boot for the GRUB menu and choose
   `6.14.0-1015-nvidia`. Then pin it:
   `sudo apt-mark hold linux-image-nvidia-hwe-24.04 linux-headers-nvidia-hwe-24.04`.
   The old `linux-modules-nvidia-580-open-6.14.0-1015-nvidia` is also still
   present, which is what makes this recoverable.
3. **containerd/docker broke the containers.** Downgrade to the captured
   versions from `dgx-pre-versions.txt`:
   `sudo apt install containerd.io=1.7.28-1~ubuntu.24.04~noble docker-ce=5:28.5.1-1~ubuntu.24.04~noble`
   then `sudo systemctl restart containerd docker`.
4. **The vault database is damaged.** Restore from the dump proved above, into
   a fresh container, then repoint. This is why the restore test is a gate and
   not a formality.

**No rollback exists for `dgx-release` 7.5.0 → 7.3.1.** DGX OS release packages
are not designed to go backwards. That is the irreversible step in this runbook,
and it is the reason for a window rather than a Tuesday evening.

## What this runbook does not cover

- Phase 1 (security-only). Separate, lower risk, run it first.
- The reranker *decision* (park vs. promote). Independent of this upgrade,
  though deciding first saves a re-test.
- Anything requiring a reboot happens only on Karl's explicit go.
