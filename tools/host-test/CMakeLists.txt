# Builds the app's LLM engine for the desktop so it can be exercised with a real
# model before it goes into an APK. Usage: see tools/host-test/README.md
cmake_minimum_required(VERSION 3.22)
project(host_test CXX C)
set(CMAKE_CXX_STANDARD 17)

set(LLAMA_DIR ${CMAKE_CURRENT_LIST_DIR}/../../third_party/llama.cpp)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)
add_subdirectory(${LLAMA_DIR} llama)

set(APP_CPP ${CMAKE_CURRENT_LIST_DIR}/../../app/src/main/cpp)
add_executable(llm_host_test main.cpp ${APP_CPP}/llm_engine.cpp)
target_include_directories(llm_host_test PRIVATE ${APP_CPP} ${LLAMA_DIR}/common)
target_link_libraries(llm_host_test PRIVATE llama llama-common)

add_executable(persona_eval persona_eval.cpp ${APP_CPP}/llm_engine.cpp)
target_include_directories(persona_eval PRIVATE ${APP_CPP} ${LLAMA_DIR}/common)
target_link_libraries(persona_eval PRIVATE llama llama-common)
