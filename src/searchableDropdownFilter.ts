/** 展开下拉且尚未改字时列出全部选项；用户输入后才按关键字过滤。 */
export function filterSearchableDropdownOptions(
  options: string[],
  searchTerm: string,
  filterBySearch: boolean,
): string[] {
  if (!filterBySearch) return options;
  const query = searchTerm.trim().toLowerCase();
  if (!query) return options;
  return options.filter((option) => option.toLowerCase().includes(query));
}
