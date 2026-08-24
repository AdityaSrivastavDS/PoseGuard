import h5py
import json
import re

model_path = 'model/poseguard_model.h5'

def fix_h5_config():
    with h5py.File(model_path, 'r+') as f:
        if 'model_config' in f.attrs:
            config_str = f.attrs['model_config']
            if isinstance(config_str, bytes):
                config_str = config_str.decode('utf-8')
            
            # Remove DTypePolicy
            # Replace {"module": "keras", "class_name": "DTypePolicy", "config": {"name": "float32"}, "registered_name": null}
            # with "float32"
            
            # Using regex to capture the whole dict structure of DTypePolicy
            pattern = re.compile(r'\{\s*"module"\s*:\s*"keras"\s*,\s*"class_name"\s*:\s*"DTypePolicy"\s*,\s*"config"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"\s*\}\s*,\s*"registered_name"\s*:\s*null\s*\}')
            
            new_config_str = pattern.sub(r'"\1"', config_str)
            
            if new_config_str != config_str:
                print("DTypePolicy removed!")
                f.attrs['model_config'] = new_config_str.encode('utf-8')
            else:
                print("No DTypePolicy found or regex failed.")
            
if __name__ == '__main__':
    fix_h5_config()
