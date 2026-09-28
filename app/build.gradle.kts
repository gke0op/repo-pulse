plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.playground.companion"
    compileSdk = 35
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "dev.playground.companion"
        minSdk = 29
        targetSdk = 35
        versionCode = 34
        versionName = "0.14.5-A"

        ndk { abiFilters += listOf("arm64-v8a") }

        externalNativeBuild {
            cmake {
                // Native code is always built optimized, even in debug APKs:
                // a debug llama.cpp is ~10x slower and would poison every measurement.
                arguments += listOf(
                    "-DCMAKE_BUILD_TYPE=Release",
                    "-DANDROID_STL=c++_shared",
                    "-DBUILD_SHARED_LIBS=ON",
                    "-DLLAMA_BUILD_COMMON=ON",
                    "-DLLAMA_OPENSSL=OFF",
                    "-DGGML_NATIVE=OFF",
                    "-DGGML_BACKEND_DL=ON",
                    "-DGGML_CPU_ALL_VARIANTS=ON",
                    "-DGGML_LLAMAFILE=OFF",
                )
            }
        }
    }

    externalNativeBuild {
        cmake {
            path("src/main/cpp/CMakeLists.txt")
            version = "3.31.6"
        }
    }

    buildTypes {
        debug {
            // Keep the debug variant fast; we ship debug-signed APKs for testing.
            isJniDebuggable = false
        }
    }

    // Name the APK after the build (companion-0.11.3-adults-debug.apk) so installs are tellable apart.
    applicationVariants.all {
        val v = this
        outputs.all {
            (this as com.android.build.gradle.internal.api.BaseVariantOutputImpl).outputFileName =
                "companion-${v.versionName}-${v.buildType.name}.apk"
        }
    }

    // ggml loads CPU backend variants from the native lib dir at runtime,
    // so .so files must be extracted to disk rather than mapped from the APK.
    packaging { jniLibs { useLegacyPackaging = true } }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("org.apache.commons:commons-compress:1.27.1")
    testImplementation("junit:junit:4.13.2")
}
