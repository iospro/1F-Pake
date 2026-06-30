import os

appname = "Первая Форма.app"
volume_name = "Первая Форма"
root = os.getcwd()
app_path = os.path.join(root, "dist", appname)

format = "UDZO"
compression_level = 9
filesystem = "HFS+"

size = "760M"

show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
sidebar_width = 0

window_rect = ((200, 120), (760, 420))
default_view = "icon-view"
show_icon_preview = False
include_icon_view_settings = True
include_list_view_settings = False

icon_size = 96
text_size = 12
arrange_by = None
grid_offset = (0, 0)
grid_spacing = 100
scroll_position = (0, 0)
label_pos = "bottom"

background = os.path.join(root, "scripts", "dmg-background-white-arrow.png")

files = [app_path]
symlinks = {"Программы": "/Applications"}

contents = [
    (app_path, (180, 190)),
    ("/Applications", (560, 190)),
]

icon_locations = {
    "Первая Форма.app": (180, 190),
    "Программы": (560, 190),
}
