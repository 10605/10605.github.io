# utilities for planning lectures
#

import argparse
import calendar
import datetime
import json
import pprint
import re
import os
import yaml

########## i/o

def load_any(any_file):
    if any_file.endswith('.json'):
        with open(any_file) as fp:
            return json.load(fp)
    elif any_file.endswith('.yaml'):
        with open(any_file) as fp:
            return yaml.full_load(fp)
    else:
        raise ValueError(f'unknown file format for {any_file}')

def add_default_values(lecture_data):
    for lec_d in lecture_data:
        lec_d['summary'] = lec_d.get('summary', '')
        lec_d['content'] = lec_d.get('content', [])
        lec_d['kind'] = lec_d.get('kind', 'lecture')

def content_as_str(kind, **kw):
    v = kw.get('value', '')
    match kind:
        case 'comment':
            return v
        case 'assignment':
            return v
        case 'deck':
            title = kw['title']
            filename = kw['filename']
            num_slides = kw['num_slides']
            summary = kw['summary']
            return f'{title} ({num_slides} - {filename}) - {summary}'

def show_content(tab, kind, **kw):
    v = kw.get('value', '')
    tabbing = ' ' * tab
    match kind:
        case 'comment':
            print(f'{tabbing}{v}')
        case 'assignment':
            print(f'{tabbing}{v}')
        case 'deck':
            keys = "title filename summary prereqs taught".split(' ')
            for key in keys:
                if kw[key]:
                    print(f"{tabbing} - {key:10s}:{kw[key]}")


def get_assignments(content, **kw):
    # get a list of assignment lines (which start with '* ' in lectures file)
    hw_contents = [c for c in content if c.get('kind', '') == 'assignment']
    if not hw_contents:
        return None
    else:
        def unstar(val):
            return val[len('* '):] if val.startswith('* ') else val 
        return [unstar(c['value']) for c in hw_contents]

def lecture_with_hw_as_str(**lec_d):
    line1 = lecture_as_str(**lec_d)
    assignments = get_assignments(**lec_d)
    return line1 if assignments is None else f'{line1}\n{" "*18}{", ".join(assignments)}'

def lecture_as_str(title, summary, printable_date, content, **kw):
    num_slides = sum([d.get('num_slides', 0) for d in content])
    with_summary = f' - {summary}' if summary else ''
    return f'{printable_date:17s} {title} ({num_slides} slides){with_summary}'

def show_lecture(title, summary, printable_date, content, **kw):
    print(lecture_as_str(title, summary, printable_date, content, **kw))
    for c in content:
        print(f'  {content_as_str(**c)}')

def lecture_row_as_str(title, summary, printable_date, content, **kw):
    # cols are date, meeting type, title, resources, announcements
    tab = " " * 24
    
    meeting_type = dict(
        recitation='<strong class="label label-red">Recitation</strong>',
        lecture='<strong class="label label-pink">Lecture</strong>')
    assignments = get_assignments(content=content) or ['']
    rsrc_links = dict([it for c in lec_d['content'] for link in c.get('links',[]) for it in link.items()]).items()
    def make_href(link, text):
        if link:
            return f'<a href="{link}">{text}</a>'
        else:
            return ''
    def make_href_for_list_of_texts(link, texts):
        if not texts:
            return ''
        if link:
            texts = [f'<a href="{link}">{texts[0]}</a>'] + texts[1:]
        return '<br/> '.join(texts)
    slide_href = make_href(kw.get('slide_link'), '/ Slides (pdf)')
    pptx_href = make_href(kw.get('pptx_link'), '/ Slides (pptx)')
    movie_href = make_href(kw.get('movie_link'), '/ Recording')
    notebook_href = make_href(kw.get('notebook_link'), '/ Notebook')
    hw_href = make_href_for_list_of_texts(kw.get('hw_link'), assignments)
    lines = []
    lines.append(f'{" "*20}<tr>')
    lines.append(f'{tab}<td>{printable_date}</td>')
    lines.append(f'{tab}<td>{meeting_type[kw.get("type", "lecture")]}</td>')
    lines.append(f'{tab}<td>{title} {slide_href} {pptx_href} {notebook_href} {movie_href}</td>')
    lines.append(f'{tab}<td>')
    lines.append(f'{tab}  <ul>')
    for url, text in rsrc_links:
        lines.append(f'{tab}  <li><a href="{url}">{text}</a>')
    lines.append(f'{tab}  </ul>')
    lines.append(f'{tab}</td>')
    lines.append(f'{tab}<td>{hw_href}</td>')
    lines.append(f'{" "*20}</tr>')
    lines.append(f'{" "*20}<tr>')
    lines.append(f'{" "*20}</tr>')
    return '\n'.join(lines) + '\n'

########## checking prereqs

def check_constraints(lecture_data):
    taught_so_far = {}
    violations = 0
    for lec_d in lecture_data:
        when = lec_d['printable_date']
        print(lec_d['title'], when, 'prereqs...')
        for c in lec_d['content']:
            if c['kind'] != 'deck':
                continue
            for prereq in c['prereqs']:
                if prereq in taught_so_far:
                    print(c['filename'], 'needs', prereq, 'taught', taught_so_far[prereq])
                else:
                    print(c['filename'], 'needs', prereq, '- NOT TAUGHT YET')
                    violations += 1
            for prereq in c['taught']:
                taught_so_far[prereq] = when
    print(violations, 'ordering violations')


########## slide-db stuff

def as_content_d(content_line, slide_data):
    if content_line.startswith('#'):
        return dict(
            kind='comment',
            value=content_line)
    elif content_line.startswith('*'):
        return dict(
            kind='assignment',
            value=content_line)
    else:
        slide_d = slide_data.get(content_line, dict(num_slides=0.1, summary=' | NOT IN DB'))
        summary = slide_d['summary']
        if " | " in summary:
            summary,  title = summary.split(" | ")
            concepts = re.findall(r'[!+]\w+', summary)
            prereqs = [c[1:] for c in concepts if c[0]=='!']
            taught = [c[1:] for c in concepts if c[0]=='+']
        else:
            summary, title = '', summary
            concepts = prereqs = taught = []
        return dict(
            kind='deck',
            filename=content_line,
            title=title,
            num_slides=slide_d['num_slides'],
            summary=summary,
            concepts=concepts,
            prereqs=prereqs,
            links=slide_d.get('links',[]),
            taught=taught)

def join_slide_content(lecture_data, slide_data):
    for lec_d in lecture_data:
        try:
            lec_d['content'] = [as_content_d(line, slide_data) for line in lec_d['content']]
        except KeyError:
            lec_d['content'] = []
        except TypeError:
            lec_d['content'] = []

########## calendar stuff

def join_lecture_dates(lecture_data, config):
    """Add all the dates to lectures.
    """
    for lec_d, date_d in zip(lecture_data, lecture_dates(lecture_data, config)):
        lec_d.update(date_d)

def class_is_cancelled(month, day, config):
    """Is this class cancelled according to the config file?
    """
    month_day_tup = (month, day)
    for month_day_list in config['DATES_WITH_NO_CLASS']:
        if month_day_tup == tuple(month_day_list):
            return True
    return False

def gen_all_dates(config, cancelled):
    c = calendar.Calendar(0)   #monday = day index 0
    day_names = "Mon Tues Wed Thurs Fri Sat Sun".split()
    month_names = "xx Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    (start_month, start_day) = config['START_DATE']
    (end_month, end_day) = config['END_DATE']
    meeting_days = {(config['LECTURE_DAY_OF_WEEK'] + k) for k in [0,2,4]}
    for month in range(start_month, end_month + 1):
        for (day, day_of_week) in c.itermonthdays2(config['YEAR'], month):
            if day > 0 and (month > start_month or day >= start_day) and (month < end_month or day <= end_day):
                if class_is_cancelled(month, day, config) == cancelled:
                    if (day_of_week in meeting_days):
                        printable_date = "%s %s %d, %d" % (day_names[day_of_week], month_names[month], day, config['YEAR'])
                        yield dict(numeric_date=(month, day, day_of_week), printable_date=printable_date)


def new_week(last_lec_d, lec_d):
    if last_lec_d is None: return False
    return last_lec_d['numeric_date'][-1] > lec_d['numeric_date'][-1]

def lecture_dates(lecture_data, config):
    """List of dicts with fields numeric_date=(month, day, day_of_
    week), printable_date=string where printable_date is of the form
    "Tues Jul 4", months are 0 <= k < 12, days are 1...31, and
    day_of_week is 0 for Mon, 1 for Tues, etc.

    Dates are limited to those that are valid according to the config
    params of START_DATE, END_DATE, DATES_WITH_NO_CLASS, and
    LECTURE_DAY_OF_WEEK.  LECTURE_DAY_OF_WEEK should be 0 for Mon/Wed
    classes, 1 for Tues/Thus.  START_DATE, END_DATE should be (month,
    day) as integers, eg (1, 13) for Jan 13.
    """
    return list(gen_all_dates(config, cancelled=False))

def add_cancelled_dates(lecture_data, config):
    for date_d in gen_all_dates(config, cancelled=True):
        lecture_data.append(dict(title='NO CLASS', content=[], summary='', **date_d))
    lecture_data.sort(key=lambda lec_d: lec_d['numeric_date'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument(
        'action',
        choices=['html', 'syllabus', 'check', 'calendar', 'next'],
        help="\n".join([
            'html: generate schedule.html;',
            'syllabus: summary of planned lectures;',
            'calendar: shorter summary of planned lectures;',
            'next: syllabus output for next --n lectures'])
    )
    parser.add_argument(
        '--config',
        default='config.yaml',
        help='basic info on dates for the course + html generation')
    parser.add_argument(
        '--lectures',
        default='lectures.yaml',
        help='database of info on each lecture')
    parser.add_argument(
        '--slides',
        default='slides.yaml',
        help='database of info on decks for individual "modules"')
    parser.add_argument(
        '--show_cancelled',
        action='store_true',
        help='show dates of cancelled clsses')
    parser.add_argument(
        '--show_weeks',
        action='store_true',
        help='show dividing lines between weeks')
    parser.add_argument(
        '--n',
        type=int,
        default=1,
        help='with action "next", show next n lectures')
    args = parser.parse_args()

    config = load_any(args.config)
    lecture_data = load_any(args.lectures)
    add_default_values(lecture_data)
    slide_data = load_any(args.slides)
    join_lecture_dates(lecture_data, config)
    if args.show_cancelled:
        add_cancelled_dates(lecture_data, config)
    join_slide_content(lecture_data, slide_data)

    if args.action == 'syllabus':
        for lec_d in lecture_data:
            show_lecture(**lec_d)

    elif args.action == 'next':
        today = datetime.date.today()
        mon, day = today.month, today.day
        k = 0
        for lec_d in lecture_data:
            lmon, lday, _ = lec_d['numeric_date']
            if lmon > mon or (lmon==mon and lday >= day):
                show_lecture(**lec_d)
                k += 1
                if k >= args.n:
                    break
            

    elif args.action == 'check':
        check_constraints(lecture_data)

    elif args.action == 'html':
        schedule_filename = os.path.join(config['BASEDIR'], config['SCHEDULE_FILE'])
        schedule_headname = os.path.join(config['BASEDIR'], config['HEADER'])
        schedule_footname = os.path.join(config['BASEDIR'], config['FOOTER'])
        with open(schedule_filename, 'w') as fp:
            for line in open(schedule_headname):
                fp.write(line)
            for lec_d in lecture_data:
                if 'printable_date' not in lec_d:
                    lec_d['printable_date'] = '?NO DATE - probably too many lectures scheduled'
                fp.write(lecture_row_as_str(**lec_d))
            for line in open(schedule_footname):
                fp.write(line)
        print(f'wrote to {schedule_filename}')

    elif args.action == 'calendar':
        last_lec_d = None
        for lec_d in lecture_data:
            if args.show_weeks and new_week(last_lec_d, lec_d):
                print('-' * 40)
            print(lecture_with_hw_as_str(**lec_d))
            last_lec_d = lec_d

    else:
        raise ValueError(f'wtf is {args.action}')
