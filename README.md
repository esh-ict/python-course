# Python — ICT — European School The Hague

Live site: the folders `s3/` and `s5/` are the two published courses. `index.html` is the
landing page. Everything else at the root is shared: the editor, the styles, and
`review.html` for collecting student work.

Python runs inside the student's browser tab. Nothing is sent anywhere, no accounts,
no logins. Saving writes a real `.py` file into a OneDrive folder the student picks once.

## Never edit the HTML

The `.html` files are output. A rebuild overwrites them. Edit the markdown instead.

| To change | Edit |
|---|---|
| A page from the original Trinket course | `source/md/00-first-steps-in-python/NN-slug.md` |
| A build, the warm-up, While loop, For loop | `source/extra/NN-slug.md` |
| Which pages appear in which year group | `source/courses.json` |

## Rebuilding

On your own computer, from the repository folder:

```bash
python3 source/build_site.py source/md .
```

That regenerates `s3/`, `s5/` and the landing page. Then upload the changed files to
GitHub — dragging the whole folder in again is safe, since files with the same name are
replaced.

## The S4 full course

The complete Trinket course is still in `source/`, but it is not published: its entry in
`courses.json` has `"_id"` instead of `"id"`, so the builder skips it. Rename that key to
`"id"` and rebuild to publish it. To read it privately, build it locally and open the files
from your own disk rather than uploading them.

## Student task files

A saved file is named after `data-task`, which is the page slug plus the activity number —
so `04-relational-operators-06.py`. Renumbering an activity mid-term detaches students'
saved work from the task it belongs to. Add new activities at the end during a term;
renumber freely between years.

## Collecting work

Students share their OneDrive folder with you once. Add a shortcut to each in your own
OneDrive, then open `review.html`, click **Open folder**, and point at the folder holding
those shortcuts. You get a coverage grid plus every file grouped by student or by task.
It reads from your disk only and never writes.

## Still to do

- Ten images are hotlinked from other websites and will eventually rot. `build_site.py`
  lists them on every run; download them into `assets/` and repoint.
- Check the marks bands in Build 1 and the prices in Build 2 against real practice.
