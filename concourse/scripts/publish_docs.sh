#!/bin/sh

set -eou

cd ./fauna-js-repository

PACKAGE_VERSION=$(node -p -e "require('./package.json').version")
npm install
npm run doc

cd ../
mkdir doc
cp -R ./fauna-js-repository/doc/* ./doc/

echo "Current docs version: $PACKAGE_VERSION"

apk add --no-cache git
git clone fauna-js-repository-docs fauna-js-repository-updated-docs

cd fauna-js-repository-updated-docs

rm -rf ./*
cp -R ../doc/* ./

git config --global user.email "nobody@concourse-ci.org"
git config --global user.name "Concourse CI"

git add -A
git commit -m "Update docs to version: $PACKAGE_VERSION"
