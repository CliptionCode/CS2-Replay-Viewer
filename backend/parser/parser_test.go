package parser

import (
	"testing"

	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
)

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

func TestDroppedEquipmentCategory(t *testing.T) {
	tests := []struct {
		equipmentType common.EquipmentType
		category      string
		visible       bool
	}{
		{common.EqAK47, "weapon", true},
		{common.EqKnife, "weapon", true},
		{common.EqZeus, "weapon", true},
		{common.EqSmoke, "utility", true},
		{common.EqFlash, "utility", true},
		{common.EqBomb, "", false},
		{common.EqDefuseKit, "", false},
	}

	for _, test := range tests {
		category, visible := droppedEquipmentCategory(common.NewEquipment(test.equipmentType))
		if category != test.category || visible != test.visible {
			t.Fatalf("%s category = %q, %v; want %q, %v", test.equipmentType, category, visible, test.category, test.visible)
		}
	}
}

func TestDroppedEquipmentPositionChangedUsesMovementThreshold(t *testing.T) {
	item := DroppedEquipment{X: 100, Y: 200, Z: 10}
	if droppedEquipmentPositionChanged(item, 102, 200, 10) {
		t.Fatal("two-unit movement should stay in the current position segment")
	}
	if !droppedEquipmentPositionChanged(item, 105, 200, 10) {
		t.Fatal("five-unit movement should start a new position segment")
	}
}
