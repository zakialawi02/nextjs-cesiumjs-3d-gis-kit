import ezdxf
from ezdxf import colors
import json
import sys
import os

def get_rgb_hex(rgb_int):
    # Convert 24-bit integer true color to hex string
    r = (rgb_int >> 16) & 0xff
    g = (rgb_int >> 8) & 0xff
    b = rgb_int & 0xff
    return f"#{r:02X}{g:02X}{b:02X}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python parse_dxf_colors.py <dxf_path>", file=sys.stderr)
        sys.exit(1)

    dxf_path = sys.argv[1]
    if not os.path.exists(dxf_path):
        print(f"Error: File not found: {dxf_path}", file=sys.stderr)
        sys.exit(1)

    try:
        doc = ezdxf.readfile(dxf_path)
    except Exception as e:
        print(f"Error reading DXF: {e}", file=sys.stderr)
        sys.exit(1)

    handle_color_map = {}

    # Iterate over all entities in the entity database
    # This includes modelspace, paperspaces, and block definitions
    for entity in doc.entitydb.values():
        if not entity.has_dxf_attrib('handle'):
            continue

        handle = entity.dxf.handle.upper()
        
        # 1. Try true_color on the entity itself
        if entity.has_dxf_attrib('true_color') and entity.dxf.true_color is not None:
            handle_color_map[handle] = get_rgb_hex(entity.dxf.true_color)
            continue
            
        # 2. Get ACI color of the entity
        # If not present, default is 256 (BYLAYER)
        color_index = entity.dxf.color if entity.has_dxf_attrib('color') else 256
        
        if color_index == 256:
            # Resolve ByLayer color
            layer_name = entity.dxf.layer if entity.has_dxf_attrib('layer') else '0'
            if doc.layers.has_entry(layer_name):
                layer = doc.layers.get(layer_name)
                # Try layer's true_color first
                if layer.has_dxf_attrib('true_color') and layer.dxf.true_color is not None:
                    handle_color_map[handle] = get_rgb_hex(layer.dxf.true_color)
                    continue
                # Fallback to layer's ACI color
                layer_color_index = layer.dxf.color
                # ACI index can be negative for turned off layers, take absolute value
                layer_color_index = abs(layer_color_index)
                # Convert layer's ACI to RGB
                try:
                    rgb = colors.aci2rgb(layer_color_index)
                    handle_color_map[handle] = f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
                except Exception:
                    handle_color_map[handle] = "#FFFFFF" # default fallback
            else:
                handle_color_map[handle] = "#FFFFFF"
                
        elif color_index == 0:
            # BYBLOCK - default to #FFFFFF
            handle_color_map[handle] = "#FFFFFF"
            
        else:
            # ACI color
            try:
                rgb = colors.aci2rgb(abs(color_index))
                handle_color_map[handle] = f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
            except Exception:
                handle_color_map[handle] = "#FFFFFF"

    # Print JSON map to stdout
    print(json.dumps(handle_color_map))

if __name__ == "__main__":
    main()
