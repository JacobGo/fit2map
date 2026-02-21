cmake_minimum_required(VERSION 3.20)
project(fit2map VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Export compile commands for IDE / clangd support
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

include(FetchContent)

FetchContent_Declare(
    fit_cpp_sdk
    GIT_REPOSITORY https://github.com/garmin/fit-cpp-sdk.git
    GIT_TAG        21.194.0
)

FetchContent_GetProperties(fit_cpp_sdk)
if(NOT fit_cpp_sdk_POPULATED)
    FetchContent_MakeAvailable(fit_cpp_sdk)
endif()

file(GLOB FIT_SDK_SOURCES "${fit_cpp_sdk_SOURCE_DIR}/src/*.cpp")

add_library(fit_cpp_sdk STATIC ${FIT_SDK_SOURCES})
target_include_directories(fit_cpp_sdk PUBLIC "${fit_cpp_sdk_SOURCE_DIR}/src")

add_executable(fit2map
    src/main.cc
)

target_compile_options(fit2map PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)

target_link_libraries(fit2map PRIVATE fit_cpp_sdk)
