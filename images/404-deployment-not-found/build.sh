#!/bin/bash

# Build script for 404-deployment-not-found
IMAGE_NAME="ghcr.io/kibamail/404-deployment-not-found"
TAG=${1:-latest}

echo "Building image: ${IMAGE_NAME}:${TAG}"

docker build -t "${IMAGE_NAME}:${TAG}" .

if [ $? -eq 0 ]; then
    echo "Image built successfully!"
    echo ""
    echo "To push to GitHub Container Registry:"
    echo "docker push ${IMAGE_NAME}:${TAG}"
    echo ""
    echo "To run locally:"
    echo "docker run -p 3000:3000 ${IMAGE_NAME}:${TAG}"
else
    echo "Build failed!"
    exit 1
fi
