package parser

import "testing"

func TestSmokeFadeTickAlwaysUsesFullIndependentDuration(t *testing.T) {
	const firstDetonationTick = 848
	const secondDetonationTick = 1100

	if got := getNadeFadeTick("smoke", firstDetonationTick); got != firstDetonationTick+smokeDurationTicks {
		t.Fatalf("first smoke fade tick = %d, want %d", got, firstDetonationTick+smokeDurationTicks)
	}
	if got := getNadeFadeTick("smoke", secondDetonationTick); got != secondDetonationTick+smokeDurationTicks {
		t.Fatalf("second smoke fade tick = %d, want %d", got, secondDetonationTick+smokeDurationTicks)
	}
}
