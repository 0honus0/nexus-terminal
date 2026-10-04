# Queued directory refresh coalescing

Only contiguous tail refreshes that have not started share a promise. Starting a refresh clears the merge slot; enqueueing any navigation also clears it. Running refreshes are never reused. The latest merged path-draft revision is retained. Navigation ordering, remote directory reads and error handling remain unchanged.

Three baseline and three candidate samples per workload used the real file-manager UI and isolated SSH fixture with 300 ms directory-open delay. Single-refresh medians were 362.49/368.61 ms; five same-turn clicks were 1883.56/366.25 ms, with exact request counts 5/1 and peak pending requests 1. Each sample verified a newly created entry and unchanged directory path. This establishes a synchronous-burst benefit, not faster individual refreshes or a claim about all ordinary user clicks.

The initial candidate run failed the old five-request assertion. Its artifacts were archived in `/tmp/opencode/opt-16-candidate-request-contract-failure.tar.gz` before the measurement contract was updated. Content assertions were retained, not weakened.

A separate boundary check passed: after the first request was sent and still pending, another refresh produced exactly two serial requests; a new remote entry was visible and the path remained correct. The default test now asserts candidate behavior; `NEXUS_E2E_SERIAL_REFRESH_BASELINE=1` is only for measuring restored serial production code. Logs are `/tmp/opencode/opt-16-queued-refresh-{baseline,valid-candidate,active-boundary}.log`.

Cross-navigation, failure recovery and changes occurring after remote enumeration have not been separately behavior-tested. The merge slot is invalidated by enqueueNavigation, but that code review is not equivalent to race coverage. Full fixed-SHA CI remains outstanding.
