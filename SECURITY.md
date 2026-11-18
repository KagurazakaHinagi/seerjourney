# Security

The hosted map, campaign logs, documents, and saved images are public by design. Editor passphrases protect modifications; they do not make campaign content private. Fog is a visual gameplay aid, not protection against downloading the underlying map artwork.

Do not put credentials, private notes, personal data, or unpublished map sources in public issues. For a vulnerability, use the repository's private vulnerability reporting feature when enabled. If it is unavailable, request a private contact channel from a maintainer without posting exploit details or secrets.

Report the affected version, a minimal reproduction using the demo or your own permitted fixture, expected behavior, and impact. Keep tests away from production data. There is no guaranteed response-time SLA.

Operators should keep editor passphrases and signing/database/Blob credentials in server-only environment configuration, isolate previews from production, and back up Redis state and image objects separately. See the [deployment guide](docs/vercel-deployment.md) for recovery and configuration.
