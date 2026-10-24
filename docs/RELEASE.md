# Release scope and verification

OpenChartDeck is a local source distribution under Apache-2.0, copyright 2026 Amlan Limaye. Its tagline is “Simple, open-source market charts.”

Include only the standalone viewer, read-only adapters, labelled equivalent instruments, optional unknown-delay Gate candidates, synthetic demo/tests, setup/security/privacy documentation and dependency notices. Exclude market caches, actual-price screenshots, raw provider responses, private chart inventories, browser state, credentials, `node_modules`, unrelated experiments and prior workspace Git history.

## Release sequence

1. Run the JavaScript tests, private-launcher fixture tests, browser demo checks and dependency advisory check.
2. Review the exact staged manifest and `npm run check:release` results. Set the approved author and verified GitHub-provided noreply commit email in this repository only.
3. Recheck the initial commit tree and history, then publish only to the repository authorized by the owner.
4. Verify the remote commit matches the reviewed local commit and check macOS/Linux CI before tagging a release.

No npm publication, hosted website, market-data relay, cloud deployment or new account grant is part of this release. Provider terms remain independent of the code license. Private vulnerability reporting is optional; do not disclose sensitive details in a public issue when no private channel is available.

An open-source program application is separate from source publication. Publishing this project does not establish adoption, external users, maintenance history or program eligibility.
