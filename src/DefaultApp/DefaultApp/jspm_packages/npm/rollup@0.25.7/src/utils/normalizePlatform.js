/* */ 
"format cjs";
export function unixizePath ( path ) {
	return path.split( /[\/\\]/ ).join( '/' );
}
