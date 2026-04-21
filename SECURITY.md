# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Currently supported versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within API Workbench, please send an email to **matthias@example.com**. All security vulnerabilities will be promptly addressed.

**Please do not report security vulnerabilities through public GitHub issues.**

### What to Include

When reporting a vulnerability, please include:

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Initial Response**: Within 48 hours of report submission
- **Status Update**: Within 7 days with an estimated timeline for a fix
- **Fix Release**: Security patches will be released as soon as possible, typically within 30 days

## Security Best Practices

When using API Workbench:

1. **Keep the application updated** to the latest version
2. **Be cautious with SSL certificate verification** - only disable SSL verification for trusted development environments
3. **Protect sensitive data** - API keys, tokens, and credentials stored in environments are saved locally
4. **Review scripts carefully** - pre-request and post-request scripts execute JavaScript in the main process (see Script Execution above); only run scripts you trust
5. **Use environment variables** - avoid hardcoding sensitive information in requests

## Known Security Considerations

- **Local Storage**: Collections, environments, and history are stored locally on your machine
- **Script Execution**: Pre/post-request scripts run in the Electron **main process** inside Node’s [`node:vm`](https://nodejs.org/api/vm.html) with a frozen sandbox (`console`, `client`, and built-in `url`, `crypto`, `util`). Treat user scripts as trusted code. Execution is limited to a **30 second** wall-clock timeout per run. A future release may use a stricter isolate (for example `isolated-vm` or a dedicated utility process).
- **HTML response preview**: The Preview tab uses a **sandboxed** iframe (`sandbox=""`) and Angular’s HTML sanitizer so remote HTML cannot run script in the parent app context the way a fully trusted `srcdoc` binding would.
- **File imports**: After you pick a file in a system dialog, file contents are read in the **main process** only; there is no arbitrary `readFile(path)` IPC from the renderer.
- **Proxy Settings**: When using proxy configurations, ensure your proxy server is trusted
- **Certificate Management**: Custom SSL certificates are stored locally; protect your certificate files

## Disclosure Policy

When we receive a security bug report, we will:

1. Confirm the problem and determine affected versions
2. Audit code to find any similar problems
3. Prepare fixes for all supported versions
4. Release new versions as soon as possible

## Comments on this Policy

If you have suggestions on how this process could be improved, please submit a pull request or open an issue.
