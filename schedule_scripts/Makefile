schedule:
	python3 util.py html

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
	python3 util.py html --config config-local.yaml
	git add lectures.yaml slides.yaml ../schedule.html
	git commit -m 'updated lecture'
	echo now git push

gitpull:
	rm -f ../schedule.html
	mv lectures.yaml lectures-upd.yaml
	git pull
	diff lectures.yaml lectures-upd.yaml
