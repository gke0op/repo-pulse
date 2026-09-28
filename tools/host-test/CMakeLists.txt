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

add_executable(memory_eval memory_eval.cpp ${APP_CPP}/llm_engine.cpp)
target_include_directories(memory_eval PRIVATE ${APP_CPP} ${LLAMA_DIR}/common)
target_link_libraries(memory_eval PRIVATE llama llama-common)

add_executable(recall_eval recall_eval.cpp ${APP_CPP}/llm_engine.cpp)
target_include_directories(recall_eval PRIVATE ${APP_CPP} ${LLAMA_DIR}/common)
target_link_libraries(recall_eval PRIVATE llama llama-common)

add_executable(drift_eval drift_eval.cpp ${APP_CPP}/llm_engine.cpp)
target_include_directories(drift_eval PRIVATE ${APP_CPP} ${LLAMA_DIR}/common)
target_link_libraries(drift_eval PRIVATE llama llama-common)

# Smart Turn check: needs ONNX Runtime's C library for the host (ORT_DIR = an onnxruntime release dir).
if(ORT_DIR)
    add_executable(turn_eval turn_eval.cpp ${APP_CPP}/smart_turn.cpp)
    target_include_directories(turn_eval PRIVATE ${APP_CPP} ${ORT_DIR}/include)
    target_link_directories(turn_eval PRIVATE ${ORT_DIR}/lib)
    target_link_libraries(turn_eval PRIVATE onnxruntime)
    set_target_properties(turn_eval PROPERTIES BUILD_RPATH ${ORT_DIR}/lib)
endif()

add_executable(distill_eval distill_eval.cpp ${APP_CPP}/llm_engine.cpp)
target_include_directories(distill_eval PRIVATE ${APP_CPP} ${LLAMA_DIR}/common)
target_link_libraries(distill_eval PRIVATE llama llama-common)
