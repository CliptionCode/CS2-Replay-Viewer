package serialize

import (
	"testing"

	"github.com/yourname/cs2-replay-viewer/backend/parser"
)

func TestConvertFramePreservesReloadState(t *testing.T) {
	frame := convertFrame(&parser.PlayerFrame{IsReloading: true})

	if !frame.IsReloading {
		t.Fatal("converted frame should preserve the active reload state")
	}
}

func TestConvertBombPreservesPlantPosition(t *testing.T) {
	bomb := convertBomb(&parser.BombEvent{X: 123.5, Y: -456.25, Z: 78})

	if bomb.X != 123.5 || bomb.Y != -456.25 || bomb.Z != 78 {
		t.Fatalf("converted bomb position = (%v, %v, %v)", bomb.X, bomb.Y, bomb.Z)
	}
}

func TestConvertNadePreservesSeparate3DTrajectory(t *testing.T) {
	nade := convertNade(&parser.NadeEvent{
		Trajectory:   []parser.TrajectoryPoint{{Tick: 10, X: 1, Y: 2, Z: 3}},
		Trajectory3D: []parser.TrajectoryPoint{{Tick: 11, X: 4, Y: 5, Z: 6}},
	})

	if len(nade.Trajectory) != 1 || nade.Trajectory[0].Tick != 10 {
		t.Fatal("converted nade should preserve its original 2D trajectory")
	}
	if len(nade.Trajectory_3D) != 1 || nade.Trajectory_3D[0].Tick != 11 {
		t.Fatal("converted nade should preserve its per-tick 3D trajectory")
	}
}
