function pruneBucket(bucket, windowMs, now) {
    const cutoff = now - windowMs;
    while (bucket.length && bucket[0] <= cutoff) {
        bucket.shift();
    }
}

export function createRateLimiter({windowMs, max, keyGenerator, message, cleanupIntervalMs = 60 * 1000}) {
    const hits = new Map();
    let cleanupTimer = null;

    const cleanup = () => {
        const now = Date.now();
        for (const [key, bucket] of hits) {
            pruneBucket(bucket, windowMs, now);
            if (!bucket.length) {
                hits.delete(key);
            }
        }
    };

    if (cleanupIntervalMs > 0) {
        cleanupTimer = setInterval(cleanup, cleanupIntervalMs);
        cleanupTimer.unref();
    }

    const limiter = (req, res, next) => {
        const key = keyGenerator(req);
        if (!key) {
            return next();
        }

        const now = Date.now();
        const bucket = hits.get(key) || [];
        pruneBucket(bucket, windowMs, now);
        if (!bucket.length) {
            hits.delete(key);
        }
        if (bucket.length >= max) {
            return res.status(429).json({error: message});
        }

        bucket.push(now);
        hits.set(key, bucket);
        return next();
    };

    limiter.close = () => {
        if (cleanupTimer) {
            clearInterval(cleanupTimer);
            cleanupTimer = null;
        }
        hits.clear();
    };

    return limiter;
}
