# Releasing Korda

Official Linux releases are built in an older Linux container so the native `node-pty` addon does not inherit a development machine's newer glibc requirement.

Release gate:

1. `npm ci`
2. `npm test`
3. `npm run build`
4. Build the AppImage from a clean Node 22 Debian Bullseye container.
5. Confirm the desktop entry does not force `--no-sandbox`.
6. Inspect the native addon symbol versions and packaged third-party notices.
7. Smoke-test the packaged Electron runtime and PTY in the build environment.
8. Generate `SHA256SUMS` from the final artifact.
9. Create the Git tag and GitHub Release from the same source commit.

The AppImage is a release asset and must never be committed to Git. External agent CLIs are detected at runtime and are not bundled.
