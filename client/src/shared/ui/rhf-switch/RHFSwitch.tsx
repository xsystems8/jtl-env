import FormControlLabel, { FormControlLabelProps } from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Switch from '@mui/material/Switch';
import { FC, ReactNode } from 'react';
import { Controller, useFormContext } from 'react-hook-form';

interface RHFSwitchProps extends Omit<FormControlLabelProps, 'control'> {
  name: string;
  helperText?: ReactNode;
}

export const RHFSwitch: FC<RHFSwitchProps> = (props) => {
  const { name, helperText, ...other } = props;
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => (
        <div>
          <FormControlLabel control={<Switch {...field} checked={field.value} />} {...other} />

          {(!!error || helperText) && (
            <FormHelperText error={!!error}>{error ? error?.message : helperText}</FormHelperText>
          )}
        </div>
      )}
    />
  );
};
