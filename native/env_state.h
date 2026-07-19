#pragma once
#include <atomic>

// Set once at env teardown (registered in binding.cpp Init). Object
// destructors consult it to skip releasing thread-safe functions the runtime
// has already finalized. Process-wide: with worker_threads a torn-down env
// can make another env's destructors skip a release (a leak, never a crash),
// which beats the alternative — per-instance cleanup hooks dangled after GC
// and corrupted node's cleanup queue (crash at exit).
extern std::atomic<bool> nwc_env_teardown;
