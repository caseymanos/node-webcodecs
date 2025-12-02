cmake_minimum_required(VERSION 3.15)
project(webcodecs_node)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find FFmpeg packages
find_package(PkgConfig REQUIRED)
pkg_check_modules(AVCODEC REQUIRED libavcodec)
pkg_check_modules(AVUTIL REQUIRED libavutil)
pkg_check_modules(SWSCALE REQUIRED libswscale)
pkg_check_modules(SWRESAMPLE REQUIRED libswresample)

# Include N-API
include_directories(${CMAKE_JS_INC})
include_directories(${CMAKE_SOURCE_DIR}/node_modules/node-addon-api)

# Include FFmpeg headers
include_directories(${AVCODEC_INCLUDE_DIRS})
include_directories(${AVUTIL_INCLUDE_DIRS})
include_directories(${SWSCALE_INCLUDE_DIRS})
include_directories(${SWRESAMPLE_INCLUDE_DIRS})

# Source files
set(SOURCE_FILES
    native/binding.cpp
    native/encoder.cpp
    native/decoder.cpp
    native/frame.cpp
    native/audio.cpp
    native/util.cpp
    native/hw_accel.cpp
    native/image_decoder.cpp
    native/color.cpp
    native/svc.cpp
)

# Build the addon
add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

# Link FFmpeg libraries
target_link_libraries(${PROJECT_NAME}
    ${CMAKE_JS_LIB}
    ${AVCODEC_LIBRARIES}
    ${AVUTIL_LIBRARIES}
    ${SWSCALE_LIBRARIES}
    ${SWRESAMPLE_LIBRARIES}
)

# Link directories
target_link_directories(${PROJECT_NAME} PRIVATE
    ${AVCODEC_LIBRARY_DIRS}
    ${AVUTIL_LIBRARY_DIRS}
    ${SWSCALE_LIBRARY_DIRS}
    ${SWRESAMPLE_LIBRARY_DIRS}
)

# Define N-API version
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)
