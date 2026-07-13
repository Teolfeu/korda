# Security policy

## Supported version

Security fixes currently target the latest published Korda release.

## Reporting a vulnerability

Please use GitHub's private security advisory flow in the `Teolfeu/korda` repository. Do not open a public issue containing an exploit, credential, private workspace content or terminal transcript.

Include the affected version, operating system, reproduction steps and the smallest non-sensitive evidence needed to understand the problem.

## Local execution boundary

Korda starts local PTYs and browser webviews with the current user's permissions. Only open trusted workspaces, review commands before execution and keep external agent CLIs updated. Korda's cord model restricts its own broker communication; it is not an operating-system sandbox for third-party CLIs.
