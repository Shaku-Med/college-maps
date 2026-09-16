package httpapi

import (
	"sync"
	"time"
)

const maxTrackedVisitors = 100_000

type visitor struct {
	count       int
	windowStart time.Time
}

type rateLimiter struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	visitors map[string]*visitor
	now      func() time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, visitors: map[string]*visitor{}, now: time.Now}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := rl.now()
	v, ok := rl.visitors[key]
	if !ok && len(rl.visitors) >= maxTrackedVisitors {
		return false
	}
	if !ok || now.Sub(v.windowStart) >= rl.window {
		rl.visitors[key] = &visitor{count: 1, windowStart: now}
		return true
	}
	if v.count >= rl.limit {
		return false
	}
	v.count++
	return true
}

func (rl *rateLimiter) sweep() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := rl.now()
	for key, v := range rl.visitors {
		if now.Sub(v.windowStart) >= rl.window {
			delete(rl.visitors, key)
		}
	}
}

func (rl *rateLimiter) startSweeper(stop <-chan struct{}) {
	ticker := time.NewTicker(rl.window)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				rl.sweep()
			case <-stop:
				return
			}
		}
	}()
}
