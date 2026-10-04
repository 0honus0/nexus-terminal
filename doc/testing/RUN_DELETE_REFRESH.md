# Run deletion post-commit refresh

The UI deletion synchronizer retains the initial thread Run-list read, then refreshes approvals, ledger and background Runs concurrently. All refreshes settle before a rejection is propagated to the existing post-commit error handler. Delete API, transaction, guards and protocol are unchanged.

## Evidence

The installed-Agent UI scenario ran ten serial baseline samples followed by ten parallel candidate samples, with one implementation switch and one worker. All twenty scenarios passed. Earlier exploratory samples are excluded.

DELETE-response completion to test-record completion:

| Metric |         Serial |       Parallel |
| ------ | -------------: | -------------: |
| Median |       38.62 ms |       29.24 ms |
| Range  | 37.21–40.95 ms | 24.93–32.04 ms |

The median reduction is 24.3%. This is response/test-observation timing, not full UI interactivity timing; sequential batch order remains a potential confounder. Logs are `/tmp/opencode/opt-22-delete-ui-{serial,parallel}-ten.log`.

A separate controlled scenario held the post-delete Run-list response, verified that the selected thread button remained disabled, released the response and verified that the button became enabled. The scenario and existing exact deletion assertions passed. Log: `/tmp/opencode/opt-22-delete-ui-sync-barrier.log`.

The user accepted the common-path benefit without requiring exhaustive checks of other scenarios. Large-history performance, forced navigation/unmount, and injected post-commit failure/retry were not behavior-tested. Existing refresh generation checks and error handling are retained; waiting for all requests before reporting rejection intentionally differs from serial early failure. This change does not claim to resolve all historical deletion stalls. Full fixed-commit CI remains pending for this commit.
