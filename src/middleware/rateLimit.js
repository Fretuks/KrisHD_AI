function pruneBucket(bucket, windowMs, now) {
    const cutoff = now - windowMs;
    while (bucket.length && bucket[0] <= cutoff) {
        bucket.shift();
    }
}

export function createRateLimiter({windowMs, max, keyGenerator, message}) {
    const hits = new Map();

    return (req, res, next) => {
        const key = keyGenerator(req);
        if (!key) {
            return next();
        }

        const now = Date.now();
        const bucket = hits.get(key) || [];
        pruneBucket(bucket, windowMs, now);
        if (bucket.length >= max) {
            return res.status(429).json({error: message});
        }

        bucket.push(now);
        hits.set(key, bucket);
        return next();
    };
}
