import sharp from "sharp";

// libvips defaults to one worker thread per CPU core *per operation* plus an
// internal pixel cache. That's a sensible default for a process handling one
// image at a time, but this app deliberately runs several edits at once — so
// those defaults multiply: measured peak RSS for 3 concurrent 2048px edits was
// 666MB with the defaults vs 428MB with these settings, for identical
// throughput (the request-level concurrency already keeps the CPU busy, so
// libvips' internal parallelism buys nothing and only costs memory).
sharp.concurrency(1);
sharp.cache(false);

export default sharp;
