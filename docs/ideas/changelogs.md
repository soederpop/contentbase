---
tags: []
status: spark
---
# Changelogs

In the cli since we have git integration we can build a kind of changelog feature.

there should be an API endoint to see a documents git history, another endpoint to get diffs, there's methods like fileLog, getChangeHistoryForFiles, diff, etc.  

we should also include the lastModified file system time on the documents api listing and details

this will help build syncing functionality into the mobile app

there should be changelog endpoint, an array of items. an item is a commit, description, and array of effected files.  only interested in the md and mdx in the collection

there should be a CLI command which looks for a docs/CHANGELOG.md if it doesn't exist, creates one starting with the last 5 changes.
