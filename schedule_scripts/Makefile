schedule:
	python3 util.py html --show_cancelled

next:
	python3 util.py next

next2:
	python3 util.py next --n 2

next3:
	python3 util.py next --n 3

push:
	git add lectures.yaml slides.yaml ../schedule.html
	git commit -m 'updated lecture'
	echo now git push

# Create copy of config.yaml named config-local.yaml and update that with the proper base dir path, then use this command.
push-local:
	python util.py html --config config-local.yaml
	git add lectures.yaml slides.yaml ../schedule.html
	git commit -m 'Updated schedule' -- lectures.yaml slides.yaml ../schedule.html
	echo now git push

gitpull:
	rm -f ../schedule.html
	mv lectures.yaml lectures-upd.yaml
	git pull
	diff lectures.yaml lectures-upd.yaml

# bring in data from William's working directory

WORKINGDIR=~/Dropbox/slide-db/working

diff-working:
	git pull
	ls -al lectures.yaml $(WORKINGDIR)/lectures.yaml
	ls -al slides.yaml $(WORKINGDIR)/delta-slides.yaml
	diff lectures.yaml $(WORKINGDIR)/lectures.yaml || true
	diff slides.yaml $(WORKINGDIR)/delta-slides.yaml || true

import-working:
	cp $(WORKINGDIR)/lectures.yaml .
	cp $(WORKINGDIR)/delta-slides.yaml slides.yaml

