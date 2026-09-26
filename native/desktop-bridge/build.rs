fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        // RPATH (rather than RUNPATH) also finds libxdo's transitive dependencies.
        // Keep this private to the helper; never change Python's library search path.
        println!("cargo:rustc-link-arg=-Wl,--disable-new-dtags,-rpath,$ORIGIN/lib");
    }
}
