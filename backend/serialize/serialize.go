package serialize

import (
	"github.com/yourname/cs2-replay-viewer/backend/parser"
	pb "github.com/yourname/cs2-replay-viewer/backend/protobuf"
	"google.golang.org/protobuf/proto"
)

func ReplayDataToProto(replay *parser.ReplayData) ([]byte, error) {
	pbReplay := &pb.ReplayData{
		Header:           convertHeader(&replay.Header),
		Map:              convertMap(&replay.Map),
		Players:          make([]*pb.PlayerInfo, 0, len(replay.Players)),
		Rounds:           make([]*pb.RoundData, 0, len(replay.Rounds)),
		Kills:            make([]*pb.KillEvent, 0, len(replay.Kills)),
		Nades:            make([]*pb.NadeEvent, 0, len(replay.Nades)),
		Flashes:          make([]*pb.FlashEvent, 0, len(replay.Flashes)),
		Noises:           make([]*pb.NoiseEvent, 0, len(replay.Noises)),
		Bombs:            make([]*pb.BombEvent, 0, len(replay.Bombs)),
		DroppedEquipment: make([]*pb.DroppedEquipment, 0, len(replay.DroppedEquipment)),
		Frames:           make([]*pb.PlayerFrame, 0, len(replay.PlayerFrames)),
	}

	for i := range replay.Players {
		pbReplay.Players = append(pbReplay.Players, convertPlayer(&replay.Players[i]))
	}

	for i := range replay.Rounds {
		pbReplay.Rounds = append(pbReplay.Rounds, convertRound(&replay.Rounds[i]))
	}

	for i := range replay.Kills {
		pbReplay.Kills = append(pbReplay.Kills, convertKill(&replay.Kills[i]))
	}

	for i := range replay.Nades {
		pbReplay.Nades = append(pbReplay.Nades, convertNade(&replay.Nades[i]))
	}

	for i := range replay.Flashes {
		pbReplay.Flashes = append(pbReplay.Flashes, convertFlash(&replay.Flashes[i]))
	}

	for i := range replay.Noises {
		pbReplay.Noises = append(pbReplay.Noises, convertNoise(&replay.Noises[i]))
	}

	for i := range replay.Bombs {
		pbReplay.Bombs = append(pbReplay.Bombs, convertBomb(&replay.Bombs[i]))
	}

	for i := range replay.DroppedEquipment {
		pbReplay.DroppedEquipment = append(pbReplay.DroppedEquipment, convertDroppedEquipment(&replay.DroppedEquipment[i]))
	}

	for i := range replay.PlayerFrames {
		pbReplay.Frames = append(pbReplay.Frames, convertFrame(&replay.PlayerFrames[i]))
	}

	return proto.Marshal(pbReplay)
}

func convertHeader(h *parser.DemoHeader) *pb.DemoHeader {
	return &pb.DemoHeader{
		MapName:         h.MapName,
		TickRate:        int32(h.TickRate),
		TotalTicks:      int32(h.TotalTicks),
		ServerName:      h.ServerName,
		PlaybackTime:    float32(h.PlaybackTime),
		BombTimeSeconds: h.BombTimeSeconds,
	}
}

func convertMap(m *parser.MapData) *pb.MapData {
	return &pb.MapData{
		Name:   m.Name,
		PosX:   m.PosX,
		PosY:   m.PosY,
		Scale:  m.Scale,
		Rotate: m.Rotate,
		Zoom:   m.Zoom,
		Width:  int32(m.Width),
		Height: int32(m.Height),
	}
}

func convertPlayer(p *parser.PlayerInfo) *pb.PlayerInfo {
	return &pb.PlayerInfo{
		SteamId:     p.SteamID,
		Name:        p.Name,
		Team:        int32(p.Team),
		Kills:       int32(p.Kills),
		Deaths:      int32(p.Deaths),
		Assists:     int32(p.Assists),
		Adr:         float32(p.ADR),
		Kast:        int32(p.KAST),
		Score:       int32(p.Score),
		TotalDamage: int32(p.TotalDamage),
	}
}

func convertRound(r *parser.RoundData) *pb.RoundData {
	return &pb.RoundData{
		RoundNumber:       int32(r.RoundNumber),
		StartTick:         int32(r.StartTick),
		EndTick:           int32(r.EndTick),
		WinnerTeam:        int32(r.WinnerTeam),
		WinReason:         r.WinReason,
		KillCount:         int32(r.KillCount),
		FreezetimeEndTick: int32(r.FreezetimeEndTick),
	}
}

func convertKill(k *parser.KillEvent) *pb.KillEvent {
	return &pb.KillEvent{
		Tick:              int32(k.Tick),
		KillerSteamId:     k.KillerSteamID,
		VictimSteamId:     k.VictimSteamID,
		AssisterSteamId:   k.AssisterSteamID,
		Weapon:            k.Weapon,
		IsHeadshot:        k.IsHeadshot,
		AssistedByFlash:   k.AssistedByFlash,
		AttackerBlind:     k.AttackerBlind,
		KillerAirborne:    k.KillerAirborne,
		NoScope:           k.NoScope,
		ThroughSmoke:      k.ThroughSmoke,
		PenetratedObjects: int32(k.PenetratedObjects),
		KillerX:           k.KillerX,
		KillerY:           k.KillerY,
		VictimX:           k.VictimX,
		VictimY:           k.VictimY,
	}
}

func convertNade(n *parser.NadeEvent) *pb.NadeEvent {
	pbNade := &pb.NadeEvent{
		Tick:           int32(n.Tick),
		ThrowerSteamId: n.ThrowerSteamID,
		NadeType:       n.NadeType,
		StartX:         n.StartX,
		StartY:         n.StartY,
		StartZ:         n.StartZ,
		EndX:           n.EndX,
		EndY:           n.EndY,
		EndZ:           n.EndZ,
		DetonationTick: int32(n.DetonationTick),
		FadeTick:       int32(n.FadeTick),
		EffectRadius:   n.EffectRadius,
		ThrowerTeam:    int32(n.ThrowerTeam),
		Trajectory:     make([]*pb.NadeTrajectoryPoint, 0, len(n.Trajectory)),
		Trajectory_3D:  make([]*pb.NadeTrajectoryPoint, 0, len(n.Trajectory3D)),
	}

	for i := range n.Trajectory {
		pbNade.Trajectory = append(pbNade.Trajectory, &pb.NadeTrajectoryPoint{
			Tick: int32(n.Trajectory[i].Tick),
			X:    n.Trajectory[i].X,
			Y:    n.Trajectory[i].Y,
			Z:    n.Trajectory[i].Z,
		})
	}
	for i := range n.Trajectory3D {
		pbNade.Trajectory_3D = append(pbNade.Trajectory_3D, &pb.NadeTrajectoryPoint{
			Tick: int32(n.Trajectory3D[i].Tick),
			X:    n.Trajectory3D[i].X,
			Y:    n.Trajectory3D[i].Y,
			Z:    n.Trajectory3D[i].Z,
		})
	}

	return pbNade
}

func convertFrame(f *parser.PlayerFrame) *pb.PlayerFrame {
	return &pb.PlayerFrame{
		Tick:           int32(f.Tick),
		SteamId:        f.SteamID,
		X:              f.X,
		Y:              f.Y,
		Z:              f.Z,
		Yaw:            f.Yaw,
		Pitch:          f.Pitch,
		Health:         int32(f.Health),
		Armor:          int32(f.Armor),
		Weapon:         f.Weapon,
		IsAlive:        f.IsAlive,
		Utilities:      append([]string(nil), f.Utilities...),
		HasBomb:        f.HasBomb,
		IsReloading:    f.IsReloading,
		EyeX:           f.EyeX,
		EyeY:           f.EyeY,
		EyeZ:           f.EyeZ,
		HasEyePosition: f.HasEyePosition,
		IsDucking:      f.IsDucking,
		OnGround:       f.OnGround,
		VelocityX:      f.VelocityX,
		VelocityY:      f.VelocityY,
		VelocityZ:      f.VelocityZ,
		Team:           int32(f.Team),
		HasDefuseKit:   f.HasDefuseKit,
	}
}

func convertFlash(f *parser.FlashEvent) *pb.FlashEvent {
	return &pb.FlashEvent{
		Tick:            int32(f.Tick),
		PlayerSteamId:   f.PlayerSteamID,
		AttackerSteamId: f.AttackerSteamID,
		DurationSeconds: f.DurationSeconds,
		EndTick:         int32(f.EndTick),
	}
}

func convertNoise(n *parser.NoiseEvent) *pb.NoiseEvent {
	return &pb.NoiseEvent{
		Tick:      int32(n.Tick),
		EndTick:   int32(n.EndTick),
		SteamId:   n.SteamID,
		X:         n.X,
		Y:         n.Y,
		Z:         n.Z,
		Radius:    n.Radius,
		NoiseType: n.NoiseType,
	}
}

func convertBomb(b *parser.BombEvent) *pb.BombEvent {
	return &pb.BombEvent{
		Tick:          int32(b.Tick),
		EventType:     b.EventType,
		PlayerSteamId: b.PlayerSteamID,
		Site:          b.Site,
		HasKit:        b.HasKit,
		X:             b.X,
		Y:             b.Y,
		Z:             b.Z,
	}
}

func convertDroppedEquipment(item *parser.DroppedEquipment) *pb.DroppedEquipment {
	return &pb.DroppedEquipment{
		StartTick:     int32(item.StartTick),
		EndTick:       int32(item.EndTick),
		EquipmentName: item.EquipmentName,
		Category:      item.Category,
		X:             item.X,
		Y:             item.Y,
		Z:             item.Z,
	}
}
