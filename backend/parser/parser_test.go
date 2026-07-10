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

func TestUpdateInfernoFadeTickUsesObservedExpiry(t *testing.T) {
	nades := []NadeEvent{{DetonationTick: 640, FadeTick: 1088}}
	indices := map[int64]int{42: 0}

	if !updateInfernoFadeTick(nades, indices, 42, 704) {
		t.Fatal("expected tracked inferno expiry to update its nade")
	}
	if got := nades[0].FadeTick; got != 704 {
		t.Fatalf("inferno fade tick = %d, want observed expiry tick 704", got)
	}
	if _, exists := indices[42]; exists {
		t.Fatal("expected expired inferno index to be removed")
	}
}

func TestUpdateInfernoFadeTickClampsInstantExpiryToStart(t *testing.T) {
	nades := []NadeEvent{{DetonationTick: 640, FadeTick: 1088}}
	indices := map[int64]int{7: 0}

	if !updateInfernoFadeTick(nades, indices, 7, 639) {
		t.Fatal("expected tracked inferno expiry to update its nade")
	}
	if got := nades[0].FadeTick; got != 640 {
		t.Fatalf("inferno fade tick = %d, want detonation tick 640", got)
	}
}

func TestDestroyedFireProjectileDoesNotStartAnotherEffectLifetime(t *testing.T) {
	const destroyTick = 1088

	for _, nadeType := range []string{"molotov", "incendiary"} {
		if got := getDestroyedProjectileFadeTick(nadeType, destroyTick); got != destroyTick {
			t.Fatalf("%s projectile fade tick = %d, want destroy tick %d", nadeType, got, destroyTick)
		}
	}
}
