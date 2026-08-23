# SAP CI/CD sandbox recon (authorized bug bounty testing)

Minimal MTA project used to test the execution sandbox of SAP's "Continuous Integration and
Delivery" service, under the SAP Bugcrowd Managed Bug Bounty program (`sap-og24`,
https://bugcrowd.com/engagements/sap-og24).

This repo exists solely to be connected as a Job source in that service. The `postinstall` hook
in `probe-module/package.json` runs `probe.js`, which performs read-only checks of the pipeline's
execution environment (container indicators, Kubernetes service-account token scope, cloud
metadata endpoint reachability, filesystem boundaries) to test for pipeline-sandbox / tenant
isolation issues. Nothing here writes, deletes, or exfiltrates data — see `probe.js` for the exact
checks and reasoning.

Not intended for any other use.
