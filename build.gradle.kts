plugins {
    kotlin("multiplatform") version "2.4.10"
    id("com.android.kotlin.multiplatform.library") version "9.3.1"
}

group = "com.maneesh.semanticpromptcontract"
version = "5.0.0"

if (JavaVersion.current() != JavaVersion.VERSION_21) {
    throw GradleException(
        "Java 21 is required to build semantic-prompt-contract. Current runtime: ${JavaVersion.current()}",
    )
}

kotlin {
    jvm()

    androidLibrary {
        namespace = "com.maneesh.semanticpromptcontract"
        compileSdk = 36
        minSdk = 24
        withHostTestBuilder {}
    }

    iosArm64()
    iosSimulatorArm64()
    macosArm64()
    macosX64()

    sourceSets {
        commonMain {
            kotlin.srcDir("adapters/kotlin/src/commonMain/kotlin")
            dependencies {
                api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
            }
        }
        commonTest {
            kotlin.srcDir("adapters/kotlin/src/commonTest/kotlin")
            dependencies {
                implementation(kotlin("test"))
            }
        }
        jvmMain {
            kotlin.srcDir("adapters/kotlin/src/jvmMain/kotlin")
        }
        androidMain {
            kotlin.srcDir("adapters/kotlin/src/androidMain/kotlin")
        }
        appleMain {
            kotlin.srcDir("adapters/kotlin/src/appleMain/kotlin")
        }
    }
}
