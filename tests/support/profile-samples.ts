// Functional CI runs every profile condition once. Repeated measurements are
// opt-in profiling; they do not add another input or failure condition.
export const profileSampleCount = Number(process.env.NEXUS_TEST_PROFILE_SAMPLES ?? 1);

if (!Number.isSafeInteger(profileSampleCount) || profileSampleCount < 1) {
	throw new Error('NEXUS_TEST_PROFILE_SAMPLES must be a positive safe integer');
}
