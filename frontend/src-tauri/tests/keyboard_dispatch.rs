//! A harness-free test gives macOS a real main thread and a pumped run loop.
//! It tests scheduling/reentrancy only: no Accessibility grant or keys needed.
#[path = "../src/keyboard_dispatch.rs"]
mod keyboard_dispatch;
use keyboard_dispatch::on_keyboard_thread;

#[cfg(not(target_os = "macos"))]
fn main() {
    let caller = std::thread::current().id();
    assert_eq!(on_keyboard_thread(|| std::thread::current().id()), caller);
    assert_eq!(on_keyboard_thread(|| Err::<(), _>("error")), Err("error"));
}

#[cfg(target_os = "macos")]
fn main() {
    use std::{
        ffi::c_void,
        sync::mpsc,
        time::{Duration, Instant},
    };
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopDefaultMode: *const c_void;
        fn CFRunLoopRunInMode(mode: *const c_void, seconds: f64, return_after_source: bool) -> i32;
    }
    assert!(objc2::MainThreadMarker::new().is_some());
    on_keyboard_thread(|| {
        on_keyboard_thread(|| {
            assert!(objc2::MainThreadMarker::new().is_some());
        })
    });
    let (tx, rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        assert!(objc2::MainThreadMarker::new().is_none());
        let result = on_keyboard_thread(|| {
            assert!(objc2::MainThreadMarker::new().is_some());
            Err::<(), _>("preserved error")
        });
        tx.send(result).unwrap();
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    let result = loop {
        if let Ok(result) = rx.try_recv() {
            break result;
        }
        assert!(
            Instant::now() < deadline,
            "main-thread keyboard dispatch stalled"
        );
        // This is how the Electron native helper services the main queue.
        unsafe {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, true);
        }
    };
    assert_eq!(result, Err("preserved error"));
    worker.join().unwrap();
}
