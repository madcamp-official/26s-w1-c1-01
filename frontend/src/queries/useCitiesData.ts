import { useQuery } from '@tanstack/react-query';
import { fetchCities, fetchCountries } from './api';
import { withCostAndColor } from '../utils/pinColor';

export function useCitiesData() {
  return useQuery({
    queryKey: ['cities'],
    queryFn: fetchCities,
    select: withCostAndColor,
  });
}

export function useCountriesData() {
  return useQuery({
    queryKey: ['countries'],
    queryFn: fetchCountries,
  });
}
