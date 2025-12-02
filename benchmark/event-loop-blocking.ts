/**
 * Benchmark: Event Loop Blocking Comparison
 *
 * This benchmark measures how much the async worker thread implementation
 * improves event loop responsiveness compared to the synchronous version.
 *
 * It encodes video frames while simultaneously running a timer that measures
 * event loop latency. Lower latency = better responsiveness.
 */

import { VideoEncoder } from '../src/VideoEncoder';
import { VideoFrame } from '../src/VideoFrame';

const WIDTH = 1280;
const HEIGHT = 720;
const FRAME_COUNT = 100;
const TIMER_INTERVAL_MS = 5;

interface BenchmarkResult {
  mode: string;
  totalEncodingTimeMs: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  p99LatencyMs: number;
  framesEncoded: number;
  latencySamples: number;
}

function createTestFrame(timestamp: number): VideoFrame {
  // Create a simple I420 frame
  const ySize = WIDTH * HEIGHT;
  const uvSize = (WIDTH / 2) * (HEIGHT / 2);
  const totalSize = ySize + uvSize * 2;

  const buffer = Buffer.alloc(totalSize);
  // Fill with a pattern based on timestamp for variety
  const val = (timestamp / 1000) % 256;
  buffer.fill(val, 0, ySize); // Y plane
  buffer.fill(128, ySize, ySize + uvSize); // U plane
  buffer.fill(128, ySize + uvSize); // V plane

  return new VideoFrame(buffer, {
    format: 'I420',
    codedWidth: WIDTH,
    codedHeight: HEIGHT,
    timestamp,
  });
}

async function runBenchmark(useWorkerThread: boolean): Promise<BenchmarkResult> {
  const mode = useWorkerThread ? 'async (worker thread)' : 'sync (blocking)';
  const latencies: number[] = [];
  let framesEncoded = 0;

  return new Promise((resolve, reject) => {
    let encoder: VideoEncoder;

    try {
      encoder = new VideoEncoder({
        output: () => {
          framesEncoded++;
        },
        error: (err) => {
          console.error(`  Error in ${mode}:`, err);
          reject(err);
        },
      });

      encoder.configure({
        codec: 'avc1.42001f', // H.264 baseline
        width: WIDTH,
        height: HEIGHT,
        bitrate: 2_000_000,
        framerate: 30,
        useWorkerThread,
      });
    } catch (err) {
      console.error(`  Failed to create encoder in ${mode}:`, err);
      reject(err);
      return;
    }

    // Start latency measurement timer
    let lastTick = process.hrtime.bigint();
    const timer = setInterval(() => {
      const now = process.hrtime.bigint();
      const elapsedNs = Number(now - lastTick);
      const elapsedMs = elapsedNs / 1_000_000;
      const latency = elapsedMs - TIMER_INTERVAL_MS;
      latencies.push(Math.max(0, latency));
      lastTick = now;
    }, TIMER_INTERVAL_MS);

    const startTime = Date.now();

    // Encode frames
    (async () => {
      try {
        for (let i = 0; i < FRAME_COUNT; i++) {
          const frame = createTestFrame(i * 33333); // ~30fps timestamps
          encoder.encode(frame);
          frame.close();
        }

        await encoder.flush();
      } catch (err) {
        clearInterval(timer);
        encoder.close();
        reject(err);
        return;
      }

      clearInterval(timer);

      const totalEncodingTimeMs = Date.now() - startTime;

      // Calculate statistics
      if (latencies.length === 0) {
        latencies.push(0);
      }
      latencies.sort((a, b) => a - b);
      const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const maxLatencyMs = latencies[latencies.length - 1];
      const p99Index = Math.floor(latencies.length * 0.99);
      const p99LatencyMs = latencies[p99Index] || maxLatencyMs;

      encoder.close();

      resolve({
        mode,
        totalEncodingTimeMs,
        avgLatencyMs,
        maxLatencyMs,
        p99LatencyMs,
        framesEncoded,
        latencySamples: latencies.length,
      });
    })();
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('Event Loop Blocking Benchmark');
  console.log('='.repeat(60));
  console.log(`Resolution: ${WIDTH}x${HEIGHT}`);
  console.log(`Frames: ${FRAME_COUNT}`);
  console.log(`Timer interval: ${TIMER_INTERVAL_MS}ms (measures event loop jitter)`);
  console.log('');

  // Check what's available
  let native: any;
  try {
    native = require('../build/Release/webcodecs_node.node');
    console.log('Native module loaded:');
    console.log(`  VideoEncoderAsync: ${native.VideoEncoderAsync ? 'available' : 'NOT available'}`);
    console.log(`  VideoEncoderNative: ${native.VideoEncoderNative ? 'available' : 'NOT available'}`);
  } catch (e) {
    console.error('Failed to load native module:', e);
    return;
  }

  console.log('');

  // Warm up
  console.log('Warming up...');
  try {
    await runBenchmark(true);
  } catch (e) {
    console.error('Warm-up failed:', e);
  }

  console.log('');
  console.log('Running benchmarks...');
  console.log('');

  const results: BenchmarkResult[] = [];

  // Run async benchmark
  console.log('Testing async (worker thread) mode...');
  try {
    const asyncResult = await runBenchmark(true);
    results.push(asyncResult);
    console.log(`  Completed: ${asyncResult.framesEncoded} frames in ${asyncResult.totalEncodingTimeMs}ms`);
    console.log(`  Latency samples: ${asyncResult.latencySamples}`);
  } catch (e) {
    console.error('Async benchmark failed:', e);
  }

  // Small delay between tests
  await new Promise(r => setTimeout(r, 1000));

  // Run sync benchmark
  console.log('Testing sync (blocking) mode...');
  try {
    const syncResult = await runBenchmark(false);
    results.push(syncResult);
    console.log(`  Completed: ${syncResult.framesEncoded} frames in ${syncResult.totalEncodingTimeMs}ms`);
    console.log(`  Latency samples: ${syncResult.latencySamples}`);
  } catch (e) {
    console.error('Sync benchmark failed:', e);
  }

  // Print results
  console.log('');
  console.log('='.repeat(60));
  console.log('Results');
  console.log('='.repeat(60));
  console.log('');
  console.log('Event Loop Latency (lower is better, 0 = perfect):');
  console.log('-'.repeat(70));
  console.log(
    'Mode'.padEnd(25) +
    'Avg (ms)'.padStart(10) +
    'P99 (ms)'.padStart(10) +
    'Max (ms)'.padStart(10) +
    'Samples'.padStart(10)
  );
  console.log('-'.repeat(70));

  for (const result of results) {
    console.log(
      result.mode.padEnd(25) +
      result.avgLatencyMs.toFixed(2).padStart(10) +
      result.p99LatencyMs.toFixed(2).padStart(10) +
      result.maxLatencyMs.toFixed(2).padStart(10) +
      result.latencySamples.toString().padStart(10)
    );
  }

  console.log('');
  console.log('Encoding Performance:');
  console.log('-'.repeat(50));
  console.log(
    'Mode'.padEnd(25) +
    'Time (ms)'.padStart(12) +
    'FPS'.padStart(10)
  );
  console.log('-'.repeat(50));

  for (const result of results) {
    const fps = (result.framesEncoded / result.totalEncodingTimeMs) * 1000;
    console.log(
      result.mode.padEnd(25) +
      result.totalEncodingTimeMs.toString().padStart(12) +
      fps.toFixed(2).padStart(10)
    );
  }

  if (results.length === 2) {
    const [asyncRes, syncRes] = results;
    console.log('');
    console.log('='.repeat(60));
    console.log('Analysis');
    console.log('='.repeat(60));

    // The key insight: how many timer ticks fired during encoding?
    // Fewer ticks = more blocking
    const expectedSamples = Math.floor(syncRes.totalEncodingTimeMs / TIMER_INTERVAL_MS);
    const asyncResponsiveness = (asyncRes.latencySamples / expectedSamples) * 100;
    const syncResponsiveness = (syncRes.latencySamples / expectedSamples) * 100;

    console.log('Event Loop Responsiveness:');
    console.log(`  Expected timer ticks (sync): ~${expectedSamples}`);
    console.log(`  Async mode actual ticks: ${asyncRes.latencySamples} (${asyncResponsiveness.toFixed(0)}% responsive)`);
    console.log(`  Sync mode actual ticks: ${syncRes.latencySamples} (${syncResponsiveness.toFixed(0)}% responsive)`);
    console.log('');

    if (syncRes.latencySamples < expectedSamples * 0.5) {
      console.log('** SYNC MODE BLOCKED THE EVENT LOOP **');
      console.log(`   Only ${syncRes.latencySamples} of ~${expectedSamples} expected timer ticks fired.`);
      console.log('   This means timers, I/O callbacks, and other async operations');
      console.log('   were delayed during encoding.');
      console.log('');
    }

    if (asyncRes.latencySamples > syncRes.latencySamples * 2) {
      const improvement = ((asyncRes.latencySamples - syncRes.latencySamples) / syncRes.latencySamples) * 100;
      console.log(`Async mode allowed ${improvement.toFixed(0)}% more event loop iterations!`);
    }

    console.log('');
    console.log('Encoding throughput:');
    const asyncFps = (asyncRes.framesEncoded / asyncRes.totalEncodingTimeMs) * 1000;
    const syncFps = (syncRes.framesEncoded / syncRes.totalEncodingTimeMs) * 1000;
    console.log(`  Async: ${asyncFps.toFixed(1)} fps`);
    console.log(`  Sync: ${syncFps.toFixed(1)} fps`);

    if (asyncFps > syncFps) {
      console.log(`  Async is ${((asyncFps / syncFps - 1) * 100).toFixed(0)}% faster!`);
    }
  }
}

main().catch(console.error);
