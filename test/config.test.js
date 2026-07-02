import test from "node:test";
import assert from "node:assert/strict";
import {createConfig} from "../src/config.js";

function withEnv(values, fn) {
    const previous = {};
    for (const key of Object.keys(values)) {
        previous[key] = process.env[key];
        if (values[key] == null) {
            delete process.env[key];
        } else {
            process.env[key] = values[key];
        }
    }

    try {
        return fn();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value == null) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

test("test mode disables request and lag logging by default", () => {
    withEnv({
        NODE_ENV: "test",
        TEST_MODE: null,
        EVENT_LOOP_LAG_MONITOR_ENABLED: null,
        SLOW_REQUEST_LOGGING_ENABLED: null
    }, () => {
        const config = createConfig();

        assert.equal(config.testMode, true);
        assert.equal(config.eventLoopLagMonitorEnabled, false);
        assert.equal(config.slowRequestLoggingEnabled, false);
    });
});

test("production rejects the default session secret", () => {
    withEnv({
        NODE_ENV: "production",
        TEST_MODE: null,
        SESSION_SECRET: null,
        COOKIE_SECURE: "true"
    }, () => {
        assert.throws(() => createConfig(), /SESSION_SECRET/);
    });
});

test("production requires secure cookies unless explicitly overridden", () => {
    withEnv({
        NODE_ENV: "production",
        TEST_MODE: null,
        SESSION_SECRET: "production-secret",
        COOKIE_SECURE: "false",
        ALLOW_INSECURE_COOKIES: null
    }, () => {
        assert.throws(() => createConfig(), /COOKIE_SECURE/);
    });
});
