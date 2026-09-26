cmake_minimum_required(VERSION 3.22.1)
project(companion C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(GGML_SYSTEM_ARCH "ARM")
    set(GGML_CPU_KLEIDIAI ON)
    set(GGML_OPENMP ON)
endif()

set(LLAMA_SRC ${CMAKE_CURRENT_LIST_DIR}/../../../../third_party/llama.cpp)
add_subdirectory(${LLAMA_SRC} build-llama)

add_library(companion SHARED llm_engine.cpp llm_jni.cpp)
target_include_directories(companion PRIVATE ${LLAMA_SRC}/common)
target_link_libraries(companion llama llama-common android log)
