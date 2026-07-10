package parser

import (
	"fmt"
	"os"
	"time"

	demoinfocs "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	events "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
)

const (
	smokeDurationTicks = 18 * 64
	fireDurationTicks  = 7 * 64
)

type ReplayData struct {
	Header           DemoHeader
	Players          []PlayerInfo
	Rounds           []RoundData
	Kills            []KillEvent
	Nades            []NadeEvent
	Flashes          []FlashEvent
	Noises           []NoiseEvent
	Bombs            []BombEvent
	DroppedEquipment []DroppedEquipment
	PlayerFrames     []PlayerFrame
	Map              MapData
}

type DemoHeader struct {
	MapName         string
	TickRate        int
	TotalTicks      int
	ServerName      string
	PlaybackTime    float64
	BombTimeSeconds float32
}

type PlayerInfo struct {
	SteamID     uint64
	Name        string
	Team        int
	Kills       int
	Deaths      int
	Assists     int
	ADR         float64
	KAST        int
	Score       int
	TotalDamage int
}

type RoundData struct {
	RoundNumber       int
	StartTick         int
	EndTick           int
	WinnerTeam        int
	WinReason         string
	KillCount         int
	FreezetimeEndTick int
	KnifeOnly         bool
}

type KillEvent struct {
	Tick              int
	KillerSteamID     uint64
	VictimSteamID     uint64
	AssisterSteamID   uint64
	Weapon            string
	IsHeadshot        bool
	AssistedByFlash   bool
	AttackerBlind     bool
	KillerAirborne    bool
	NoScope           bool
	ThroughSmoke      bool
	PenetratedObjects int
	KillerX           float32
	KillerY           float32
	VictimX           float32
	VictimY           float32
}

type NadeEvent struct {
	Tick           int
	ThrowerSteamID uint64
	NadeType       string
	StartX         float32
	StartY         float32
	StartZ         float32
	EndX           float32
	EndY           float32
	EndZ           float32
	Trajectory     []TrajectoryPoint
	DetonationTick int
	FadeTick       int
	EffectRadius   float32
}

type TrajectoryPoint struct {
	Tick int
	X    float32
	Y    float32
	Z    float32
}

type PlayerFrame struct {
	Tick    int
	SteamID uint64
	X       float32
	Y       float32
	Z       float32
	Yaw     float32
	Pitch   float32
	Health  int
	Armor   int
	Weapon  string
	IsAlive bool
}

type FlashEvent struct {
	Tick            int
	PlayerSteamID   uint64
	AttackerSteamID uint64
	DurationSeconds float32
	EndTick         int
}

type NoiseEvent struct {
	Tick      int
	EndTick   int
	SteamID   uint64
	X         float32
	Y         float32
	Z         float32
	Radius    float32
	NoiseType string
}

type BombEvent struct {
	Tick          int
	EventType     string
	PlayerSteamID uint64
	Site          string
	HasKit        bool
}

type DroppedEquipment struct {
	StartTick     int
	EndTick       int
	EquipmentName string
	Category      string
	X             float32
	Y             float32
	Z             float32
}

type MapData struct {
	Name   string
	PosX   float64
	PosY   float64
	Scale  float64
	Rotate float64
	Zoom   float64
	Width  int
	Height int
}

func ParseFile(path string) (*ReplayData, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	p := demoinfocs.NewParser(f)
	defer p.Close()

	recorder := &frameRecorder{
		playerStats:              make(map[uint64]*playerStatTracker),
		damageMap:                make(map[uint64]map[uint64]int),
		lastFrames:               make(map[uint64]PlayerFrame),
		roundStats:               make(map[int]*roundStats),
		playerRoundContributions: make(map[uint64]int),
		playerTotalRounds:        make(map[uint64]int),
		infernoNadeIndices:       make(map[int64]int),
		activeDroppedEquipment:   make(map[int]activeDroppedEquipment),
	}

	p.RegisterEventHandler(func(e events.Kill) {
		recorder.recordKill(e, p)
	})
	p.RegisterEventHandler(func(e events.RoundStart) {
		recorder.recordRoundStart(p)
	})
	p.RegisterEventHandler(func(e events.RoundEnd) {
		recorder.recordRoundEnd(e, p)
	})
	p.RegisterEventHandler(func(e events.RoundFreezetimeEnd) {
		recorder.recordRoundFreezetimeEnd(p)
	})
	p.RegisterEventHandler(func(e events.GrenadeProjectileDestroy) {
		recorder.recordNadeDestroyed(e, p)
	})
	p.RegisterEventHandler(func(e events.SmokeStart) {
		recorder.recordSmokeStart(e, p)
	})
	p.RegisterEventHandler(func(e events.InfernoStart) {
		recorder.recordInfernoStart(e, p)
	})
	p.RegisterEventHandler(func(e events.InfernoExpired) {
		recorder.recordInfernoExpired(e, p)
	})
	p.RegisterEventHandler(func(e events.FlashExplode) {
		recorder.recordFlashExplode(e, p)
	})
	p.RegisterEventHandler(func(e events.HeExplode) {
		recorder.recordHeExplode(e, p)
	})
	p.RegisterEventHandler(func(e events.DecoyStart) {
		recorder.recordDecoyStart(e, p)
	})
	p.RegisterEventHandler(func(e events.DecoyExpired) {
		recorder.recordDecoyExpired(e, p)
	})
	p.RegisterEventHandler(func(e events.PlayerFlashed) {
		recorder.recordPlayerFlashed(e, p)
	})
	p.RegisterEventHandler(func(e events.Footstep) {
		recorder.recordFootstep(e, p)
	})
	p.RegisterEventHandler(func(e events.PlayerJump) {
		recorder.recordPlayerJump(e, p)
	})
	p.RegisterEventHandler(func(e events.PlayerSound) {
		recorder.recordPlayerSound(e, p)
	})
	p.RegisterEventHandler(func(e events.WeaponFire) {
		recorder.recordWeaponFire(e, p)
	})
	p.RegisterEventHandler(func(e events.BombPlantBegin) {
		recorder.recordBombPlantBegin(e, p)
	})
	p.RegisterEventHandler(func(e events.BombPlantAborted) {
		recorder.recordBombPlantAborted(e, p)
	})
	p.RegisterEventHandler(func(e events.BombPlanted) {
		recorder.recordBombPlanted(e, p)
	})
	p.RegisterEventHandler(func(e events.BombExplode) {
		recorder.recordBombExploded(e, p)
	})
	p.RegisterEventHandler(func(e events.BombDefuseStart) {
		recorder.recordBombDefuseStart(e, p)
	})
	p.RegisterEventHandler(func(e events.BombDefuseAborted) {
		recorder.recordBombDefuseAborted(e, p)
	})
	p.RegisterEventHandler(func(e events.BombDefused) {
		recorder.recordBombDefused(e, p)
	})
	p.RegisterEventHandler(func(e events.PlayerHurt) {
		recorder.recordPlayerHurt(e, p)
	})
	p.RegisterEventHandler(func(e events.FrameDone) {
		recorder.recordFrameDone(p)
	})

	p.RegisterNetMessageHandler(func(msg *msg.CSVCMsg_ServerInfo) {
		recorder.recordServerInfo(msg)
	})

	if err := p.ParseToEnd(); err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}

	return recorder.buildReplayData(p), nil
}

type roundStats struct {
	kills   map[uint64]bool
	assists map[uint64]bool
	deaths  map[uint64]bool
	trades  map[uint64]bool
}

type killRecord struct {
	tick   int
	killer uint64
	victim uint64
}

type frameRecorder struct {
	kills                  []KillEvent
	nades                  []NadeEvent
	flashes                []FlashEvent
	noises                 []NoiseEvent
	bombs                  []BombEvent
	droppedEquipment       []DroppedEquipment
	rounds                 []RoundData
	currentRound           *RoundData
	playerFrames           []PlayerFrame
	playerStats            map[uint64]*playerStatTracker
	damageMap              map[uint64]map[uint64]int
	lastFrames             map[uint64]PlayerFrame
	lastTick               int
	mapName                string
	serverName             string
	maxTick                int
	infernoNadeIndices     map[int64]int
	activeDroppedEquipment map[int]activeDroppedEquipment

	roundStats  map[int]*roundStats
	recentKills []killRecord

	playerRoundContributions map[uint64]int
	playerTotalRounds        map[uint64]int
	firstRoundKnifeOnlySeen  bool
	firstRoundNonKnifeSeen   bool
}

type activeDroppedEquipment struct {
	segmentIndex  int
	equipmentType common.EquipmentType
	lastSeenTick  int
}

type playerStatTracker struct {
	kills       int
	deaths      int
	assists     int
	totalDamage int
}

func (r *frameRecorder) recordServerInfo(msg *msg.CSVCMsg_ServerInfo) {
	if msg.MapName != nil {
		r.mapName = *msg.MapName
	}
	if msg.HostName != nil {
		r.serverName = *msg.HostName
	}
}

func (r *frameRecorder) recordKill(e events.Kill, p demoinfocs.Parser) {
	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}

	kill := KillEvent{
		Tick:              tick,
		IsHeadshot:        e.IsHeadshot,
		AssistedByFlash:   e.AssistedFlash,
		AttackerBlind:     e.AttackerBlind,
		NoScope:           e.NoScope,
		ThroughSmoke:      e.ThroughSmoke,
		PenetratedObjects: e.PenetratedObjects,
	}

	roundNum := len(r.rounds) + 1
	if r.currentRound != nil {
		roundNum = r.currentRound.RoundNumber
	}

	if e.Killer != nil {
		kill.KillerSteamID = e.Killer.SteamID64
		kill.KillerAirborne = e.Killer.IsAirborne()
		pos := e.Killer.Position()
		kill.KillerX = float32(pos.X)
		kill.KillerY = float32(pos.Y)
		r.ensureStats(e.Killer.SteamID64).kills++

		if _, ok := r.roundStats[roundNum]; !ok {
			r.roundStats[roundNum] = &roundStats{
				kills:   make(map[uint64]bool),
				assists: make(map[uint64]bool),
				deaths:  make(map[uint64]bool),
				trades:  make(map[uint64]bool),
			}
		}
		r.roundStats[roundNum].kills[e.Killer.SteamID64] = true

		// Trade detection: check if this kill avenges a recent death
		for _, prev := range r.recentKills {
			if prev.killer == kill.KillerSteamID && tick-prev.tick <= 256 {
				if e.Victim != nil && isTeamMate(prev.victim, e.Killer.SteamID64, p) {
					r.roundStats[roundNum].trades[e.Killer.SteamID64] = true
				}
			}
		}
	}

	if e.Victim != nil {
		kill.VictimSteamID = e.Victim.SteamID64
		pos := e.Victim.Position()
		kill.VictimX = float32(pos.X)
		kill.VictimY = float32(pos.Y)
		r.ensureStats(e.Victim.SteamID64).deaths++

		if _, ok := r.roundStats[roundNum]; !ok {
			r.roundStats[roundNum] = &roundStats{
				kills:   make(map[uint64]bool),
				assists: make(map[uint64]bool),
				deaths:  make(map[uint64]bool),
				trades:  make(map[uint64]bool),
			}
		}
		r.roundStats[roundNum].deaths[e.Victim.SteamID64] = true
	}

	if e.Assister != nil {
		kill.AssisterSteamID = e.Assister.SteamID64
		r.ensureStats(e.Assister.SteamID64).assists++
		if _, ok := r.roundStats[roundNum]; !ok {
			r.roundStats[roundNum] = &roundStats{
				kills:   make(map[uint64]bool),
				assists: make(map[uint64]bool),
				deaths:  make(map[uint64]bool),
				trades:  make(map[uint64]bool),
			}
		}
		r.roundStats[roundNum].assists[e.Assister.SteamID64] = true
	}

	if e.Weapon != nil {
		kill.Weapon = e.Weapon.String()
		if r.isRecordingInitialRound() && e.Weapon.Type != common.EqKnife && e.Weapon.Type != common.EqWorld {
			r.markInitialRoundNonKnife()
		}
	}

	r.kills = append(r.kills, kill)

	// Track recent kills for trade detection
	if e.Killer != nil && e.Victim != nil {
		r.recentKills = append(r.recentKills, killRecord{
			tick:   tick,
			killer: e.Killer.SteamID64,
			victim: e.Victim.SteamID64,
		})
		// Keep only last 512 ticks worth of kills for trade detection
		cutoff := tick - 512
		keep := 0
		for i, kr := range r.recentKills {
			if kr.tick >= cutoff {
				keep = i
				break
			}
		}
		if keep > 0 {
			r.recentKills = r.recentKills[keep:]
		}
	}

	if r.currentRound != nil {
		r.currentRound.KillCount++
	}
}

func isTeamMate(steamID1, steamID2 uint64, p demoinfocs.Parser) bool {
	for _, player := range p.GameState().Participants().All() {
		if player != nil && player.SteamID64 == steamID1 {
			for _, other := range p.GameState().Participants().All() {
				if other != nil && other.SteamID64 == steamID2 {
					return player.Team == other.Team
				}
			}
		}
	}
	return false
}

func (r *frameRecorder) recordRoundStart(p demoinfocs.Parser) {
	tick := p.CurrentFrame()
	r.closeDroppedEquipment(max(0, tick-1))
	if tick > r.maxTick {
		r.maxTick = tick
	}
	roundNum := len(r.rounds) + 1
	r.currentRound = &RoundData{
		RoundNumber: roundNum,
		StartTick:   tick,
	}
	if roundNum == 1 {
		r.firstRoundKnifeOnlySeen = false
		r.firstRoundNonKnifeSeen = false
		r.observeInitialRoundInventory(p)
	}
	if _, ok := r.roundStats[roundNum]; !ok {
		r.roundStats[roundNum] = &roundStats{
			kills:   make(map[uint64]bool),
			assists: make(map[uint64]bool),
			deaths:  make(map[uint64]bool),
			trades:  make(map[uint64]bool),
		}
	}
}

func (r *frameRecorder) recordRoundEnd(e events.RoundEnd, p demoinfocs.Parser) {
	if r.currentRound == nil {
		return
	}
	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}
	r.observeInitialRoundInventory(p)
	r.closeDroppedEquipment(tick)
	if r.isRecordingInitialRound() {
		r.currentRound.KnifeOnly = r.firstRoundKnifeOnlySeen && !r.firstRoundNonKnifeSeen
	}
	r.currentRound.EndTick = tick + secondsToTicks(7, p)
	r.currentRound.WinnerTeam = int(e.Winner)
	r.currentRound.WinReason = roundEndReasonString(e.Reason)
	if r.currentRound.EndTick > r.maxTick {
		r.maxTick = r.currentRound.EndTick
	}
	r.rounds = append(r.rounds, *r.currentRound)

	// Compute KAST contributions for this round
	roundNum := r.currentRound.RoundNumber
	stats := r.roundStats[roundNum]
	if stats == nil {
		stats = &roundStats{
			kills:   make(map[uint64]bool),
			assists: make(map[uint64]bool),
			deaths:  make(map[uint64]bool),
			trades:  make(map[uint64]bool),
		}
		r.roundStats[roundNum] = stats
	}

	if !r.currentRound.KnifeOnly {
		// For every player who participated, check contribution
		for _, player := range p.GameState().Participants().All() {
			if player == nil || player.SteamID64 == 0 {
				continue
			}
			steamID := player.SteamID64
			r.playerTotalRounds[steamID]++

			contributed := stats.kills[steamID] || stats.assists[steamID] || stats.trades[steamID] || !stats.deaths[steamID]
			if contributed {
				r.playerRoundContributions[steamID]++
			}
		}
	}

	r.currentRound = nil
}

func (r *frameRecorder) recordRoundFreezetimeEnd(p demoinfocs.Parser) {
	if r.currentRound != nil {
		r.currentRound.FreezetimeEndTick = p.CurrentFrame()
		r.observeInitialRoundInventory(p)
	}
}

func (r *frameRecorder) recordNadeDestroyed(e events.GrenadeProjectileDestroy, p demoinfocs.Parser) {
	proj := e.Projectile
	if proj == nil || proj.WeaponInstance == nil {
		return
	}
	if r.isRecordingInitialRound() {
		r.markInitialRoundNonKnife()
	}

	nadeType := nadeTypeString(proj.WeaponInstance.Type)
	destroyTick := p.CurrentFrame()
	detTick := destroyTick
	fadeTick := getDestroyedProjectileFadeTick(nadeType, detTick)

	pos := proj.Position()
	trajectory := make([]TrajectoryPoint, 0, len(proj.Trajectory))

	for _, tp := range proj.Trajectory {
		trajectory = append(trajectory, TrajectoryPoint{
			Tick: tp.Tick,
			X:    float32(tp.Position.X),
			Y:    float32(tp.Position.Y),
			Z:    float32(tp.Position.Z),
		})
	}

	if nadeType == "decoy" {
		landingTick := inferStationaryEndpointStartTick(trajectory, destroyTick)
		if destroyTick-landingTick > secondsToTicks(4, p) {
			detTick = landingTick
			fadeTick = destroyTick
		}
	}

	nade := NadeEvent{
		Tick:           detTick,
		NadeType:       nadeType,
		DetonationTick: detTick,
		FadeTick:       fadeTick,
		EndX:           float32(pos.X),
		EndY:           float32(pos.Y),
		EndZ:           float32(pos.Z),
		Trajectory:     trajectory,
		EffectRadius:   nadeRadius(nadeType),
	}

	if proj.Thrower != nil {
		nade.ThrowerSteamID = proj.Thrower.SteamID64
	}

	if len(nade.Trajectory) > 0 {
		nade.StartX = nade.Trajectory[0].X
		nade.StartY = nade.Trajectory[0].Y
		nade.StartZ = nade.Trajectory[0].Z
	}

	r.nades = append(r.nades, nade)
}

func (r *frameRecorder) recordSmokeStart(e events.SmokeStart, p demoinfocs.Parser) {
	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}
	nade := NadeEvent{
		Tick:           tick,
		NadeType:       "smoke",
		DetonationTick: tick,
		FadeTick:       tick + smokeDurationTicks,
		EndX:           float32(e.Position.X),
		EndY:           float32(e.Position.Y),
		EndZ:           float32(e.Position.Z),
		EffectRadius:   200,
	}
	if e.Thrower != nil {
		nade.ThrowerSteamID = e.Thrower.SteamID64
	}
	r.nades = append(r.nades, nade)
}

func (r *frameRecorder) recordInfernoStart(e events.InfernoStart, p demoinfocs.Parser) {
	if e.Inferno == nil {
		return
	}

	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}

	position := e.Inferno.Entity.Position()
	nade := NadeEvent{
		Tick:           tick,
		NadeType:       "molotov",
		DetonationTick: tick,
		FadeTick:       getNadeFadeTick("molotov", tick),
		EndX:           float32(position.X),
		EndY:           float32(position.Y),
		EndZ:           float32(position.Z),
		EffectRadius:   nadeRadius("molotov"),
	}
	if thrower := e.Inferno.Thrower(); thrower != nil {
		nade.ThrowerSteamID = thrower.SteamID64
	}

	if r.infernoNadeIndices == nil {
		r.infernoNadeIndices = make(map[int64]int)
	}
	r.infernoNadeIndices[e.Inferno.UniqueID()] = len(r.nades)
	r.nades = append(r.nades, nade)
}

func (r *frameRecorder) recordInfernoExpired(e events.InfernoExpired, p demoinfocs.Parser) {
	if e.Inferno == nil {
		return
	}

	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}
	updateInfernoFadeTick(r.nades, r.infernoNadeIndices, e.Inferno.UniqueID(), tick)
}

func updateInfernoFadeTick(nades []NadeEvent, indices map[int64]int, infernoID int64, fadeTick int) bool {
	index, ok := indices[infernoID]
	if !ok || index < 0 || index >= len(nades) {
		return false
	}

	nades[index].FadeTick = max(nades[index].DetonationTick, fadeTick)
	delete(indices, infernoID)
	return true
}

func (r *frameRecorder) recordFlashExplode(e events.FlashExplode, p demoinfocs.Parser) {
	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}
	nade := NadeEvent{
		Tick:           tick,
		NadeType:       "flashbang",
		DetonationTick: tick,
		FadeTick:       tick + 3,
		EndX:           float32(e.Position.X),
		EndY:           float32(e.Position.Y),
		EndZ:           float32(e.Position.Z),
		EffectRadius:   400,
	}
	if e.Thrower != nil {
		nade.ThrowerSteamID = e.Thrower.SteamID64
	}
	r.nades = append(r.nades, nade)
}

func (r *frameRecorder) recordHeExplode(e events.HeExplode, p demoinfocs.Parser) {
	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}
	nade := NadeEvent{
		Tick:           tick,
		NadeType:       "hegrenade",
		DetonationTick: tick,
		FadeTick:       tick + 5,
		EndX:           float32(e.Position.X),
		EndY:           float32(e.Position.Y),
		EndZ:           float32(e.Position.Z),
		EffectRadius:   250,
	}
	if e.Thrower != nil {
		nade.ThrowerSteamID = e.Thrower.SteamID64
	}
	r.nades = append(r.nades, nade)
}

func (r *frameRecorder) recordDecoyStart(e events.DecoyStart, p demoinfocs.Parser) {
	if r.isRecordingInitialRound() {
		r.markInitialRoundNonKnife()
	}

	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}
	nade := NadeEvent{
		Tick:           tick,
		NadeType:       "decoy",
		DetonationTick: tick,
		FadeTick:       tick + 960,
		EndX:           float32(e.Position.X),
		EndY:           float32(e.Position.Y),
		EndZ:           float32(e.Position.Z),
		EffectRadius:   nadeRadius("decoy"),
	}
	if e.Thrower != nil {
		nade.ThrowerSteamID = e.Thrower.SteamID64
	}
	r.nades = append(r.nades, nade)
}

func (r *frameRecorder) recordDecoyExpired(e events.DecoyExpired, p demoinfocs.Parser) {
	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}

	throwerSteamID := uint64(0)
	if e.Thrower != nil {
		throwerSteamID = e.Thrower.SteamID64
	}

	for i := len(r.nades) - 1; i >= 0; i-- {
		nade := &r.nades[i]
		if nade.NadeType != "decoy" || len(nade.Trajectory) > 0 {
			continue
		}
		if throwerSteamID != 0 && nade.ThrowerSteamID != 0 && nade.ThrowerSteamID != throwerSteamID {
			continue
		}
		if tick < nade.DetonationTick || tick-nade.DetonationTick > secondsToTicks(20, p) {
			continue
		}

		nade.FadeTick = tick
		nade.EndX = float32(e.Position.X)
		nade.EndY = float32(e.Position.Y)
		nade.EndZ = float32(e.Position.Z)
		return
	}

	startTick := tick - 960
	if startTick < 0 {
		startTick = 0
	}
	nade := NadeEvent{
		Tick:           startTick,
		ThrowerSteamID: throwerSteamID,
		NadeType:       "decoy",
		DetonationTick: startTick,
		FadeTick:       tick,
		EndX:           float32(e.Position.X),
		EndY:           float32(e.Position.Y),
		EndZ:           float32(e.Position.Z),
		EffectRadius:   nadeRadius("decoy"),
	}
	r.nades = append(r.nades, nade)
}

func (r *frameRecorder) recordPlayerFlashed(e events.PlayerFlashed, p demoinfocs.Parser) {
	if e.Player == nil {
		return
	}

	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}

	durationSeconds := float32(e.FlashDuration().Seconds())
	if durationSeconds <= 0 && e.Player.FlashDuration > 0 {
		durationSeconds = e.Player.FlashDuration
	}
	if durationSeconds <= 0 {
		return
	}

	attackerSteamID := uint64(0)
	if e.Attacker != nil {
		attackerSteamID = e.Attacker.SteamID64
	}

	r.flashes = append(r.flashes, FlashEvent{
		Tick:            tick,
		PlayerSteamID:   e.Player.SteamID64,
		AttackerSteamID: attackerSteamID,
		DurationSeconds: durationSeconds,
		EndTick:         tick + secondsToTicks(float64(durationSeconds), p),
	})
}

func (r *frameRecorder) recordFootstep(e events.Footstep, p demoinfocs.Parser) {
	if e.Player == nil || !e.Player.IsAlive() {
		return
	}

	tick := p.CurrentFrame()
	pos := e.Player.Position()
	r.recordNoise(tick, secondsToTicks(0.28, p), e.Player.SteamID64, pos.X, pos.Y, pos.Z, 450, "running")
}

func (r *frameRecorder) recordPlayerJump(e events.PlayerJump, p demoinfocs.Parser) {
	if e.Player == nil || !e.Player.IsAlive() {
		return
	}

	tick := p.CurrentFrame()
	pos := e.Player.Position()
	r.recordNoise(tick, secondsToTicks(0.32, p), e.Player.SteamID64, pos.X, pos.Y, pos.Z, 520, "jump")
}

func (r *frameRecorder) recordPlayerSound(e events.PlayerSound, p demoinfocs.Parser) {
	if e.Player == nil || !e.Player.IsAlive() || e.Radius <= 0 {
		return
	}

	tick := p.CurrentFrame()
	durationTicks := durationToTicks(e.Duration, p)
	if durationTicks <= 0 {
		durationTicks = 24
	}

	pos := e.Player.Position()
	r.recordNoise(tick, durationTicks, e.Player.SteamID64, pos.X, pos.Y, pos.Z, e.Radius, "running")
}

func (r *frameRecorder) recordWeaponFire(e events.WeaponFire, p demoinfocs.Parser) {
	if e.Weapon != nil && e.Weapon.Type != common.EqKnife && r.isRecordingInitialRound() {
		r.markInitialRoundNonKnife()
	}
	if e.Shooter == nil || !e.Shooter.IsAlive() || e.Weapon == nil || !isShootingWeapon(e.Weapon) {
		return
	}

	tick := p.CurrentFrame()
	pos := e.Shooter.Position()
	r.recordNoise(tick, secondsToTicks(0.35, p), e.Shooter.SteamID64, pos.X, pos.Y, pos.Z, 900, "shooting")
}

func (r *frameRecorder) recordNoise(tick int, durationTicks int, steamID uint64, x, y, z float64, radius int, noiseType string) {
	if steamID == 0 || radius <= 0 {
		return
	}
	if durationTicks <= 0 {
		durationTicks = 1
	}
	if tick > r.maxTick {
		r.maxTick = tick
	}
	endTick := tick + durationTicks
	if endTick > r.maxTick {
		r.maxTick = endTick
	}

	for i := len(r.noises) - 1; i >= 0; i-- {
		existing := &r.noises[i]
		if existing.Tick != tick || existing.SteamID != steamID || existing.NoiseType != noiseType {
			if existing.Tick < tick {
				break
			}
			continue
		}
		if float32(radius) > existing.Radius {
			existing.Radius = float32(radius)
		}
		if endTick > existing.EndTick {
			existing.EndTick = endTick
		}
		existing.X = float32(x)
		existing.Y = float32(y)
		existing.Z = float32(z)
		return
	}

	r.noises = append(r.noises, NoiseEvent{
		Tick:      tick,
		EndTick:   endTick,
		SteamID:   steamID,
		X:         float32(x),
		Y:         float32(y),
		Z:         float32(z),
		Radius:    float32(radius),
		NoiseType: noiseType,
	})
}

func (r *frameRecorder) recordBombPlanted(e events.BombPlanted, p demoinfocs.Parser) {
	r.recordBombEvent("planted", e.Player, e.Site, false, p)
}

func (r *frameRecorder) recordBombPlantBegin(e events.BombPlantBegin, p demoinfocs.Parser) {
	r.recordBombEvent("plant_begin", e.Player, e.Site, false, p)
}

func (r *frameRecorder) recordBombPlantAborted(e events.BombPlantAborted, p demoinfocs.Parser) {
	r.recordBombEvent("plant_aborted", e.Player, events.BomsiteUnknown, false, p)
}

func (r *frameRecorder) recordBombExploded(e events.BombExplode, p demoinfocs.Parser) {
	r.recordBombEvent("exploded", e.Player, e.Site, false, p)
}

func (r *frameRecorder) recordBombDefuseStart(e events.BombDefuseStart, p demoinfocs.Parser) {
	r.recordBombEvent("defuse_start", e.Player, events.BomsiteUnknown, e.HasKit, p)
}

func (r *frameRecorder) recordBombDefuseAborted(e events.BombDefuseAborted, p demoinfocs.Parser) {
	r.recordBombEvent("defuse_aborted", e.Player, events.BomsiteUnknown, false, p)
}

func (r *frameRecorder) recordBombDefused(e events.BombDefused, p demoinfocs.Parser) {
	r.recordBombEvent("defused", e.Player, e.Site, false, p)
}

func (r *frameRecorder) recordBombEvent(eventType string, player *common.Player, site events.Bombsite, hasKit bool, p demoinfocs.Parser) {
	tick := p.CurrentFrame()
	if tick > r.maxTick {
		r.maxTick = tick
	}
	if r.isRecordingInitialRound() {
		r.markInitialRoundNonKnife()
	}

	playerSteamID := uint64(0)
	if player != nil {
		playerSteamID = player.SteamID64
	}

	r.bombs = append(r.bombs, BombEvent{
		Tick:          tick,
		EventType:     eventType,
		PlayerSteamID: playerSteamID,
		Site:          bombsiteString(site),
		HasKit:        hasKit,
	})
}

func (r *frameRecorder) recordPlayerHurt(e events.PlayerHurt, p demoinfocs.Parser) {
	if r.isRecordingInitialRound() && e.Weapon != nil && e.Weapon.Type != common.EqKnife && e.Weapon.Type != common.EqWorld {
		r.markInitialRoundNonKnife()
	}
	if e.Attacker == nil || e.Player == nil {
		if e.Attacker == nil && e.Player != nil && e.HealthDamage > 0 && isFallDamage(e) {
			pos := e.Player.Position()
			r.recordNoise(p.CurrentFrame(), secondsToTicks(0.38, p), e.Player.SteamID64, pos.X, pos.Y, pos.Z, 650, "falling")
		}
		return
	}
	if r.damageMap[e.Attacker.SteamID64] == nil {
		r.damageMap[e.Attacker.SteamID64] = make(map[uint64]int)
	}
	r.damageMap[e.Attacker.SteamID64][e.Player.SteamID64] += e.HealthDamage
	r.ensureStats(e.Attacker.SteamID64).totalDamage += e.HealthDamage
}

func (r *frameRecorder) recordFrameDone(p demoinfocs.Parser) {
	tick := p.CurrentFrame()
	if tick == r.lastTick {
		return
	}
	r.lastTick = tick
	if tick > r.maxTick {
		r.maxTick = tick
	}
	r.observeInitialRoundInventory(p)
	r.recordDroppedEquipment(p, tick)

	for _, player := range p.GameState().Participants().All() {
		if player == nil {
			continue
		}
		pos := player.Position()
		frame := PlayerFrame{
			Tick:    tick,
			SteamID: player.SteamID64,
			X:       float32(pos.X),
			Y:       float32(pos.Y),
			Z:       float32(pos.Z),
			Yaw:     player.ViewDirectionX(),
			Pitch:   player.ViewDirectionY(),
			Health:  player.Health(),
			Armor:   player.Armor(),
			IsAlive: player.IsAlive(),
		}
		if wep := player.ActiveWeapon(); wep != nil {
			frame.Weapon = wep.String()
		}
		r.playerFrames = append(r.playerFrames, frame)
	}
}

const droppedEquipmentMoveThresholdSquared = 16

func droppedEquipmentCategory(equipment *common.Equipment) (string, bool) {
	if equipment == nil || equipment.Type == common.EqUnknown || equipment.Type == common.EqWorld {
		return "", false
	}
	if equipment.Class() == common.EqClassGrenade {
		return "utility", true
	}
	if equipment.Class() == common.EqClassPistols ||
		equipment.Class() == common.EqClassSMG ||
		equipment.Class() == common.EqClassHeavy ||
		equipment.Class() == common.EqClassRifle ||
		equipment.Type == common.EqKnife ||
		equipment.Type == common.EqZeus {
		return "weapon", true
	}
	return "", false
}

func droppedEquipmentPositionChanged(item DroppedEquipment, x, y, z float32) bool {
	dx := item.X - x
	dy := item.Y - y
	dz := item.Z - z
	return dx*dx+dy*dy+dz*dz > droppedEquipmentMoveThresholdSquared
}

func (r *frameRecorder) closeDroppedEquipment(endTick int) {
	for entityID, active := range r.activeDroppedEquipment {
		segment := &r.droppedEquipment[active.segmentIndex]
		segment.EndTick = max(segment.StartTick, endTick)
		delete(r.activeDroppedEquipment, entityID)
	}
}

func isEquipmentDropped(equipment *common.Equipment, p demoinfocs.Parser) bool {
	if equipment == nil || equipment.Entity == nil {
		return false
	}
	ownerValue, ok := equipment.Entity.PropertyValue("m_hOwnerEntity")
	if ok && ownerValue.Any != nil {
		return p.GameState().Participants().FindByPawnHandle(ownerValue.Handle()) == nil
	}
	return equipment.Owner == nil
}

func (r *frameRecorder) recordDroppedEquipment(p demoinfocs.Parser, tick int) {
	if r.currentRound == nil {
		r.closeDroppedEquipment(max(0, tick-1))
		return
	}

	seen := make(map[int]struct{})
	for entityID, equipment := range p.GameState().Weapons() {
		category, supported := droppedEquipmentCategory(equipment)
		if !supported || !isEquipmentDropped(equipment, p) {
			continue
		}

		position := equipment.Entity.Position()
		x, y, z := float32(position.X), float32(position.Y), float32(position.Z)
		seen[entityID] = struct{}{}
		active, exists := r.activeDroppedEquipment[entityID]
		if exists && active.equipmentType != equipment.Type {
			segment := &r.droppedEquipment[active.segmentIndex]
			segment.EndTick = max(segment.StartTick, tick-1)
			delete(r.activeDroppedEquipment, entityID)
			exists = false
		}

		if exists {
			segment := &r.droppedEquipment[active.segmentIndex]
			if droppedEquipmentPositionChanged(*segment, x, y, z) {
				segment.EndTick = max(segment.StartTick, tick-1)
				exists = false
			} else {
				segment.EndTick = tick
				active.lastSeenTick = tick
				r.activeDroppedEquipment[entityID] = active
			}
		}

		if !exists {
			r.droppedEquipment = append(r.droppedEquipment, DroppedEquipment{
				StartTick:     tick,
				EndTick:       tick,
				EquipmentName: equipment.String(),
				Category:      category,
				X:             x,
				Y:             y,
				Z:             z,
			})
			r.activeDroppedEquipment[entityID] = activeDroppedEquipment{
				segmentIndex:  len(r.droppedEquipment) - 1,
				equipmentType: equipment.Type,
				lastSeenTick:  tick,
			}
		}
	}

	for entityID, active := range r.activeDroppedEquipment {
		if _, ok := seen[entityID]; ok && active.lastSeenTick == tick {
			continue
		}
		segment := &r.droppedEquipment[active.segmentIndex]
		segment.EndTick = max(segment.StartTick, tick-1)
		delete(r.activeDroppedEquipment, entityID)
	}

}

func (r *frameRecorder) ensureStats(steamID uint64) *playerStatTracker {
	if _, ok := r.playerStats[steamID]; !ok {
		r.playerStats[steamID] = &playerStatTracker{}
	}
	return r.playerStats[steamID]
}

func tickRateOrDefault(p demoinfocs.Parser) float64 {
	tickRate := p.TickRate()
	if tickRate <= 0 {
		return 64
	}
	return tickRate
}

func secondsToTicks(seconds float64, p demoinfocs.Parser) int {
	return int(seconds*tickRateOrDefault(p) + 0.5)
}

func durationToTicks(duration time.Duration, p demoinfocs.Parser) int {
	if duration <= 0 {
		return 0
	}
	return secondsToTicks(duration.Seconds(), p)
}

func getNadeFadeTick(nadeType string, detTick int) int {
	switch nadeType {
	case "smoke":
		return detTick + smokeDurationTicks
	case "hegrenade":
		return detTick + 5
	case "flashbang":
		return detTick + 3
	case "molotov", "incendiary":
		return detTick + fireDurationTicks
	case "decoy":
		return detTick + 960
	default:
		return detTick
	}
}

func getDestroyedProjectileFadeTick(nadeType string, destroyTick int) int {
	if nadeType == "molotov" || nadeType == "incendiary" {
		return destroyTick
	}
	return getNadeFadeTick(nadeType, destroyTick)
}

func inferStationaryEndpointStartTick(trajectory []TrajectoryPoint, fallbackTick int) int {
	if len(trajectory) < 2 {
		return fallbackTick
	}

	finalPoint := trajectory[len(trajectory)-1]
	stationaryStartTick := finalPoint.Tick

	for i := len(trajectory) - 2; i >= 0; i-- {
		point := trajectory[i]
		if trajectoryDistanceSquared(point, finalPoint) > 16 {
			if stationaryStartTick > 0 {
				return stationaryStartTick
			}
			return fallbackTick
		}
		if point.Tick > 0 {
			stationaryStartTick = point.Tick
		}
	}

	return fallbackTick
}

func trajectoryDistanceSquared(a, b TrajectoryPoint) float32 {
	dx := a.X - b.X
	dy := a.Y - b.Y
	dz := a.Z - b.Z
	return dx*dx + dy*dy + dz*dz
}

func isShootingWeapon(weapon *common.Equipment) bool {
	if weapon == nil {
		return false
	}
	switch weapon.Class() {
	case common.EqClassPistols, common.EqClassSMG, common.EqClassHeavy, common.EqClassRifle:
		return true
	default:
		return false
	}
}

func isFallDamage(e events.PlayerHurt) bool {
	if e.Weapon != nil && e.Weapon.Type == common.EqWorld {
		return true
	}
	return e.WeaponString == "world" || e.WeaponString == "fall" || e.WeaponString == "falldamage"
}

func (r *frameRecorder) isRecordingInitialRound() bool {
	return r.currentRound != nil && r.currentRound.RoundNumber == 1
}

func (r *frameRecorder) markInitialRoundNonKnife() {
	if !r.isRecordingInitialRound() {
		return
	}
	r.firstRoundNonKnifeSeen = true
	r.currentRound.KnifeOnly = false
}

func (r *frameRecorder) observeInitialRoundInventory(p demoinfocs.Parser) {
	if !r.isRecordingInitialRound() || r.firstRoundNonKnifeSeen {
		return
	}

	knifeOnly, hasNonKnife := inspectKnifeOnlyRoundInventory(p)
	if hasNonKnife {
		r.markInitialRoundNonKnife()
		return
	}
	if knifeOnly {
		r.firstRoundKnifeOnlySeen = true
		r.currentRound.KnifeOnly = true
	}
}

func isKnifeRoundIgnoredEquipment(weapon *common.Equipment) bool {
	if weapon == nil {
		return true
	}
	switch weapon.Type {
	case common.EqBomb, common.EqKevlar, common.EqHelmet, common.EqDefuseKit:
		return true
	default:
		return false
	}
}

func inspectKnifeOnlyRoundInventory(p demoinfocs.Parser) (knifeOnly bool, hasNonKnife bool) {
	playersChecked := 0
	for _, player := range p.GameState().Participants().All() {
		if player == nil || player.SteamID64 == 0 || !player.IsAlive() {
			continue
		}
		if player.Team != common.TeamTerrorists && player.Team != common.TeamCounterTerrorists {
			continue
		}

		weapons := player.Weapons()
		if len(weapons) == 0 {
			continue
		}

		hasKnife := false
		for _, weapon := range weapons {
			if isKnifeRoundIgnoredEquipment(weapon) {
				continue
			}
			if weapon.Type != common.EqKnife {
				return false, true
			}
			hasKnife = true
		}
		if hasKnife {
			playersChecked++
		}
	}

	return playersChecked >= 2, false
}

func isKnifeOnlyRound(p demoinfocs.Parser) bool {
	knifeOnly, hasNonKnife := inspectKnifeOnlyRoundInventory(p)
	return knifeOnly && !hasNonKnife
}

func removeInitialKnifeRound(rounds []RoundData) []RoundData {
	if len(rounds) == 0 || !rounds[0].KnifeOnly {
		return rounds
	}

	filtered := make([]RoundData, 0, len(rounds)-1)
	for i := 1; i < len(rounds); i++ {
		round := rounds[i]
		round.RoundNumber = len(filtered) + 1
		filtered = append(filtered, round)
	}
	return filtered
}

func clampRoundEndTicks(rounds []RoundData) []RoundData {
	for i := 0; i < len(rounds)-1; i++ {
		maxEndTick := rounds[i+1].StartTick - 1
		if maxEndTick > rounds[i].StartTick && rounds[i].EndTick > maxEndTick {
			rounds[i].EndTick = maxEndTick
		}
	}
	return rounds
}

func bombsiteString(site events.Bombsite) string {
	switch site {
	case events.BombsiteA:
		return "A"
	case events.BombsiteB:
		return "B"
	default:
		return ""
	}
}

func (r *frameRecorder) buildReplayData(p demoinfocs.Parser) *ReplayData {
	r.closeDroppedEquipment(r.maxTick)
	replay := &ReplayData{}
	tickRate := int(tickRateOrDefault(p))
	bombTimeSeconds := float32(40)
	if bombTime, err := p.GameState().Rules().BombTime(); err == nil && bombTime > 0 {
		bombTimeSeconds = float32(bombTime.Seconds())
	}

	replay.Header = DemoHeader{
		MapName:         r.mapName,
		TickRate:        tickRate,
		TotalTicks:      r.maxTick,
		ServerName:      r.serverName,
		BombTimeSeconds: bombTimeSeconds,
	}

	replay.Kills = r.kills
	replay.Nades = r.nades
	replay.Flashes = r.flashes
	replay.Noises = r.noises
	replay.Bombs = r.bombs
	replay.DroppedEquipment = r.droppedEquipment
	replay.Rounds = clampRoundEndTicks(removeInitialKnifeRound(r.rounds))
	replay.PlayerFrames = r.playerFrames

	replay.Map = MapData{
		Name:   r.mapName,
		Scale:  4.4,
		Width:  1024,
		Height: 1024,
	}

	for _, player := range p.GameState().Participants().All() {
		if player == nil || player.SteamID64 == 0 {
			continue
		}
		info := PlayerInfo{
			SteamID: player.SteamID64,
			Name:    player.Name,
			Team:    int(player.Team),
			Score:   player.Score(),
		}
		if stats, ok := r.playerStats[player.SteamID64]; ok {
			info.Kills = stats.kills
			info.Deaths = stats.deaths
			info.TotalDamage = stats.totalDamage
		}
		replay.Players = append(replay.Players, info)
	}

	roundCount := len(replay.Rounds)
	if roundCount > 0 {
		for i := range replay.Players {
			if replay.Players[i].TotalDamage > 0 {
				replay.Players[i].ADR = float64(replay.Players[i].TotalDamage) / float64(roundCount)
			}
			steamID := replay.Players[i].SteamID
			totalRounds := r.playerTotalRounds[steamID]
			contributions := r.playerRoundContributions[steamID]
			if totalRounds > 0 {
				replay.Players[i].KAST = int(float64(contributions) / float64(totalRounds) * 100)
			}
		}
	}

	return replay
}

func nadeTypeString(et common.EquipmentType) string {
	switch et {
	case common.EqSmoke:
		return "smoke"
	case common.EqHE:
		return "hegrenade"
	case common.EqFlash:
		return "flashbang"
	case common.EqMolotov:
		return "molotov"
	case common.EqIncendiary:
		return "incendiary"
	case common.EqDecoy:
		return "decoy"
	default:
		return "unknown"
	}
}

func nadeRadius(nadeType string) float32 {
	switch nadeType {
	case "smoke":
		return 200
	case "hegrenade":
		return 250
	case "flashbang":
		return 400
	case "molotov", "incendiary":
		return 150
	case "decoy":
		return 200
	default:
		return 100
	}
}

func roundEndReasonString(reason events.RoundEndReason) string {
	switch reason {
	case events.RoundEndReasonCTWin:
		return "ct_win"
	case events.RoundEndReasonTerroristsWin:
		return "t_win"
	case events.RoundEndReasonTargetBombed:
		return "bomb_detonated"
	case events.RoundEndReasonBombDefused:
		return "bomb_defused"
	case events.RoundEndReasonTargetSaved:
		return "target_saved"
	case events.RoundEndReasonDraw:
		return "draw"
	case events.RoundEndReasonCTSurrender:
		return "ct_surrender"
	case events.RoundEndReasonTerroristsSurrender:
		return "t_surrender"
	default:
		return "unknown"
	}
}
