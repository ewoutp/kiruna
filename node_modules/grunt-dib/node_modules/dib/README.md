dib
===

Docker image builder for (mostly) Node.js oriented images.

Why
===

Various tools exist (like progrium/buildstep) that can build Docker images from a git repository.
This tools is a little bit different:

1. It works from a locally cloned repository (or even if you have just a folder).
2. It does not require any kind of git access control inside your Docker container, so perfect for private repositories.

Requirements
============

- package.json: Describe your image by means of a Node module. 
  The package "name" will be used for the name of the image.
  The package "version" will be used to tag the image.
- Dockerfile: Any regular docker file, but you do not have to ADD your files. 'dib' will add all files in the repository to it automatically.

Installation
============

```
npm install -g dib
```

Usage
=====

Go to the repository folder (containing package.json and Dockerfile).
Then execute:

```
dib
```

Which files are added to my image?
==================================

All files in the repository are added, except:

- .git/**
- .gitignore
- .npmignore
- Gruntfile.js
- All files list in .gitignore and .npmignore

The node_modules folder is pruned for production before creating the image.
This is done in a temporary folder, so nothing changes in your original repository.

Where is my app inside the image?
=================================

The entire repository (excluding the files mentioned above) are copied to '/app/' inside the image.
