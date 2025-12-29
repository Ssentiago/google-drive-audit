use governor::clock::DefaultClock;
use governor::state::{InMemoryState, NotKeyed};
use governor::{Quota, RateLimiter};
use once_cell::sync::Lazy;
use std::num::NonZeroU32;
use std::sync::Arc;
use tokio::sync::Semaphore;

pub static GLOBAL_SEMAPHORE: Lazy<Arc<Semaphore>> = Lazy::new(|| {
    Arc::new(Semaphore::new(10))
});

pub static GLOBAL_RATE_LIMITER: Lazy<RateLimiter<NotKeyed, InMemoryState, DefaultClock>> =
    Lazy::new(|| {
        RateLimiter::direct(
            Quota::per_second(NonZeroU32::new(20).unwrap())
                .allow_burst(NonZeroU32::new(30).unwrap()), // burst 30
        )
    });
