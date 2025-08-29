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

gitpull:
	rm -f ../schedule.html
	mv lectures.yaml lectures-upd.yaml
	git pull
	diff lectures.yaml lectures-upd.yaml
